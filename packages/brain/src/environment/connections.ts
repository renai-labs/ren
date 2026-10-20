export * as EnvironmentConnections from "./connections.js"

import { EnvironmentApi } from "@ren/environment-api/environment-api"
import { EnvironmentClient } from "@ren/environment-api/environment-client"
import type { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import {
  Clock,
  Context,
  DateTime,
  Duration,
  Effect,
  Exit,
  Layer,
  RcMap,
  Redacted,
  Ref,
  Schema,
  Scope,
  SynchronizedRef,
} from "effect"
import { HttpClient } from "effect/http"
import { EnvironmentAccess } from "./access.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("EnvironmentConnections.Unavailable", {
  sessionId: Session.ID,
  reason: Schema.Literals([
    "no_access",
    "ren_unavailable",
    "unreachable",
    "token_refused",
    "incompatible",
    "directory_failed",
  ]),
  message: Schema.String,
}) {}

export const failureOf = (value: unknown): { readonly message: string } | undefined => {
  if (value instanceof Unavailable) return value
  if (EnvironmentClient.isNoAnswer(value) && value instanceof Error)
    return { message: `The environment does not answer: ${value.message}` }
  return undefined
}

export const refreshBefore = Duration.minutes(5)

export const retryRenAfter = Duration.seconds(30)

const isSameEnvironment = (held: Environment.Access, fresh: Environment.Access) =>
  fresh.url.href === held.url.href && fresh.generation === held.generation && fresh.directory === held.directory

export interface Connection {
  readonly hello: EnvironmentApi.Hello
  readonly client: EnvironmentClient.Client
}

export interface Interface {
  readonly connect: (sessionId: Session.ID) => Effect.Effect<Connection, Unavailable, Scope.Scope>
  readonly release: (sessionId: Session.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/brain/EnvironmentConnections") {}

interface Entry {
  readonly connection: Connection
  readonly checkAccess: Effect.Effect<void, Unavailable>
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const environmentAccess = yield* EnvironmentAccess.Service
    const http = yield* HttpClient.HttpClient
    const liveEntries = new Map<Session.ID, SynchronizedRef.SynchronizedRef<Environment.Access>>()
    const renDown = new Map<Session.ID, { readonly untilMs: number; readonly error: Unavailable }>()
    const openAccess = Effect.fn("EnvironmentConnections.openAccess")(function* (sessionId: Session.ID) {
      const down = renDown.get(sessionId)
      if (down && (yield* Clock.currentTimeMillis) < down.untilMs) return yield* down.error
      return yield* environmentAccess.open(sessionId).pipe(
        Effect.mapError((error) =>
          error._tag === "EnvironmentAccess.NotFound"
            ? new Unavailable({
                sessionId,
                reason: "no_access",
                message: `No access to an environment: ${error.message}`,
              })
            : new Unavailable({
                sessionId,
                reason: "ren_unavailable",
                message: `Ren does not answer: ${error.message}`,
              }),
        ),
        Effect.tap(() => Effect.sync(() => renDown.delete(sessionId))),
        Effect.tapError((error) =>
          error.reason === "ren_unavailable"
            ? Effect.map(Clock.currentTimeMillis, (now) =>
                renDown.set(sessionId, { untilMs: now + Duration.toMillis(retryRenAfter), error }),
              )
            : Effect.void,
        ),
      )
    })

    const connections: RcMap.RcMap<Session.ID, Entry, Unavailable> = yield* RcMap.make({
      idleTimeToLive: Duration.infinity,
      lookup: Effect.fn("EnvironmentConnections.lookup")(function* (sessionId: Session.ID) {
        const entryScope = yield* Effect.scope
        const attempt = yield* Scope.fork(entryScope)
        return yield* Effect.gen(function* () {
          const access = yield* openAccess(sessionId)
          const receivedAtMs = yield* Clock.currentTimeMillis
          const refreshWindow = Duration.min(
            refreshBefore,
            Duration.millis((DateTime.toEpochMillis(access.expiresAt) - receivedAtMs) / 3),
          )
          const storedAccess = yield* SynchronizedRef.make(access)
          liveEntries.set(sessionId, storedAccess)
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (liveEntries.get(sessionId) === storedAccess) liveEntries.delete(sessionId)
            }),
          )
          const invalidateSelf = Effect.suspend(() =>
            liveEntries.get(sessionId) === storedAccess ? RcMap.invalidate(connections, sessionId) : Effect.void,
          )
          const refusedToken = yield* Ref.make<string | undefined>(undefined)
          const freshAccess = SynchronizedRef.updateAndGetEffect(storedAccess, (latest) =>
            Effect.gen(function* () {
              const isRefused = (yield* Ref.get(refusedToken)) === Redacted.value(latest.token)
              const now = yield* Clock.currentTimeMillis
              if (!isRefused && DateTime.toEpochMillis(latest.expiresAt) - now > Duration.toMillis(refreshWindow))
                return latest
              return yield* openAccess(sessionId).pipe(
                Effect.flatMap((fresh) =>
                  isSameEnvironment(latest, fresh) ? Effect.succeed(fresh) : invalidateSelf.pipe(Effect.as(latest)),
                ),
                Effect.catch((error) =>
                  error.reason === "no_access"
                    ? invalidateSelf.pipe(Effect.as(latest))
                    : Effect.logWarning(`Could not refresh the access of session ${sessionId}: ${error.message}`).pipe(
                        Effect.as(latest),
                      ),
                ),
              )
            }),
          )
          const client = yield* EnvironmentClient.make({
            url: access.url,
            token: Effect.map(freshAccess, (latest) => Redacted.value(latest.token)),
            onNoAnswer: invalidateSelf,
            onRefused: (token) => Ref.set(refusedToken, token),
          }).pipe(Effect.provideService(HttpClient.HttpClient, http))
          const unreachableBecause = (cause: { readonly _tag: string; readonly message: string }) =>
            cause._tag === "UnauthorizedError"
              ? new Unavailable({
                  sessionId,
                  reason: "token_refused",
                  message: `The environment at ${access.url} refused the access token from Ren`,
                })
              : new Unavailable({
                  sessionId,
                  reason: "unreachable",
                  message: `The environment at ${access.url} does not answer: ${cause.message}`,
                })
          const hello = yield* client["executor.hello"]().pipe(Effect.mapError(unreachableBecause))
          if (hello.protocol !== EnvironmentApi.protocol)
            return yield* new Unavailable({
              sessionId,
              reason: "incompatible",
              message: `The executor is not compatible: it speaks protocol ${hello.protocol}, not ${EnvironmentApi.protocol}`,
            })
          yield* client["files.mkdir"]({ path: access.directory }).pipe(
            Effect.mapError((error) =>
              error._tag === "FileSystemError"
                ? new Unavailable({
                    sessionId,
                    reason: "directory_failed",
                    message: `Could not make the directory ${access.directory} on the environment: ${error.message}`,
                  })
                : unreachableBecause(error),
            ),
          )
          const checkAccess: Effect.Effect<void, Unavailable> = Effect.gen(function* () {
            const latest = yield* freshAccess
            const now = yield* Clock.currentTimeMillis
            if (DateTime.toEpochMillis(latest.expiresAt) > now) return
            yield* invalidateSelf
            const down = renDown.get(sessionId)
            if (down && now < down.untilMs) return yield* down.error
            return yield* new Unavailable({
              sessionId,
              reason: "ren_unavailable",
              message: "The access to the environment expired",
            })
          })
          return { connection: { hello, client }, checkAccess }
        }).pipe(
          Scope.provide(attempt),
          Effect.onError(() => Scope.close(attempt, Exit.void)),
        )
      }),
    })
    return Service.of({
      connect: Effect.fn("EnvironmentConnections.connect")(function* (sessionId: Session.ID) {
        const entry = yield* RcMap.get(connections, sessionId).pipe(
          Effect.tapError(() => RcMap.invalidate(connections, sessionId)),
        )
        yield* entry.checkAccess
        return entry.connection
      }),
      release: Effect.fn("EnvironmentConnections.release")(function* (sessionId: Session.ID) {
        yield* RcMap.invalidate(connections, sessionId)
        yield* environmentAccess
          .release(sessionId)
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning(`Could not release the environment seat of session ${sessionId}: ${error.message}`),
            ),
          )
      }),
    })
  }),
)
