export * as HandConnections from "./hand-connections.js"

import { type Hello, protocol } from "@ren/hand-api/executor-api"
import { ExecutorClient } from "@ren/hand-api/executor-client"
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
  Option,
  RcMap,
  Ref,
  Schema,
  Scope,
  SynchronizedRef,
} from "effect"
import { HttpClient } from "effect/http"
import { HandAccess } from "./hand-access.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("HandConnections.Unavailable", {
  sessionId: Session.ID,
  reason: Schema.Literals(["no_access", "ren_unavailable", "unreachable", "token_refused", "incompatible", "unusable"]),
  message: Schema.String,
}) {}

export const refreshBefore = Duration.minutes(5)

export const retryRenAfter = Duration.seconds(30)

const isSameSandbox = (held: Environment.Access, fresh: Environment.Access) =>
  fresh.url === held.url && fresh.generation === held.generation && fresh.directory === held.directory

export interface Connection {
  readonly hello: Hello
  readonly client: ExecutorClient.Client
  readonly directory: string
}

export interface Interface {
  readonly connect: (sessionId: Session.ID) => Effect.Effect<Connection, Unavailable, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@ren/brain/HandConnections") {}

interface Entry {
  readonly connection: Connection
  readonly ready: Effect.Effect<void, Unavailable>
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const handAccess = yield* HandAccess.Service
    const http = yield* HttpClient.HttpClient
    const accesses = new Map<Session.ID, SynchronizedRef.SynchronizedRef<Environment.Access>>()
    const failures = new Map<Session.ID, { readonly error: Unavailable; readonly retryAtMs: number }>()

    const ask = Effect.fn("HandConnections.ask")(function* (sessionId: Session.ID) {
      const now = yield* Clock.currentTimeMillis
      const failed = failures.get(sessionId)
      if (failed?.error.reason === "ren_unavailable" && now < failed.retryAtMs) return yield* failed.error
      return yield* handAccess.open(sessionId).pipe(
        Effect.tap(() => Effect.sync(() => failures.delete(sessionId))),
        Effect.mapError((error) =>
          error._tag === "HandAccess.NotFound"
            ? new Unavailable({ sessionId, reason: "no_access", message: `No access to a sandbox: ${error.message}` })
            : new Unavailable({
                sessionId,
                reason: "ren_unavailable",
                message: `Ren does not answer: ${error.message}`,
              }),
        ),
        Effect.tapError((error) =>
          Effect.sync(() => failures.set(sessionId, { error, retryAtMs: now + Duration.toMillis(retryRenAfter) })),
        ),
      )
    })

    const connections: RcMap.RcMap<Session.ID, Entry, Unavailable> = yield* RcMap.make({
      idleTimeToLive: Duration.infinity,
      lookup: Effect.fn("HandConnections.lookup")(function* (sessionId: Session.ID) {
        const entryScope = yield* Effect.scope
        const attempt = yield* Scope.fork(entryScope)
        return yield* Effect.gen(function* () {
          const access = yield* ask(sessionId)
          const receivedAtMs = yield* Clock.currentTimeMillis
          const window = Duration.min(
            refreshBefore,
            Duration.millis((DateTime.toEpochMillis(access.expiresAt) - receivedAtMs) / 3),
          )
          const current = yield* SynchronizedRef.make(access)
          accesses.set(sessionId, current)
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (accesses.get(sessionId) === current) accesses.delete(sessionId)
            }),
          )
          const invalidateSelf = Effect.suspend(() =>
            accesses.get(sessionId) === current ? RcMap.invalidate(connections, sessionId) : Effect.void,
          )
          const refusedToken = yield* Ref.make<string | undefined>(undefined)
          const held = SynchronizedRef.updateAndGetEffect(current, (latest) =>
            Effect.gen(function* () {
              const isRefused = (yield* Ref.get(refusedToken)) === latest.token
              const now = yield* Clock.currentTimeMillis
              if (!isRefused && DateTime.toEpochMillis(latest.expiresAt) - now > Duration.toMillis(window))
                return latest
              return yield* ask(sessionId).pipe(
                Effect.flatMap((fresh) =>
                  isSameSandbox(latest, fresh) ? Effect.succeed(fresh) : invalidateSelf.pipe(Effect.as(latest)),
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
          const client = yield* ExecutorClient.make({
            url: access.url,
            token: Effect.map(held, (latest) => latest.token),
            onNoAnswer: invalidateSelf,
          }).pipe(
            Effect.provideService(
              HttpClient.HttpClient,
              HttpClient.transform(http, (response, request) =>
                Effect.tap(response, (received) =>
                  received.status === 401
                    ? Ref.set(refusedToken, request.headers.authorization?.replace(/^Bearer /, ""))
                    : Effect.void,
                ),
              ),
            ),
          )
          const noAnswer = (cause: { readonly _tag: string; readonly message: string }) =>
            cause._tag === "UnauthorizedError"
              ? new Unavailable({
                  sessionId,
                  reason: "token_refused",
                  message: `The sandbox at ${access.url} refused the access token from Ren`,
                })
              : new Unavailable({
                  sessionId,
                  reason: "unreachable",
                  message: `The sandbox at ${access.url} does not answer: ${cause.message}`,
                })
          const hello = yield* client["executor.hello"]().pipe(Effect.mapError(noAnswer))
          if (hello.protocol !== protocol)
            return yield* new Unavailable({
              sessionId,
              reason: "incompatible",
              message: `The executor is not compatible: it speaks protocol ${hello.protocol}, not ${protocol}`,
            })
          if (hello.environmentId !== access.environmentId)
            return yield* new Unavailable({
              sessionId,
              reason: "incompatible",
              message: `The executor is not compatible: it serves environment ${hello.environmentId}, not ${access.environmentId}`,
            })
          yield* client["files.mkdir"]({ path: access.directory }).pipe(
            Effect.mapError((error) =>
              error._tag === "OperationFailedError"
                ? new Unavailable({
                    sessionId,
                    reason: "unusable",
                    message: `Could not make the folder ${access.directory} on the sandbox: ${error.message}`,
                  })
                : noAnswer(error),
            ),
          )
          const ready: Effect.Effect<void, Unavailable> = Effect.gen(function* () {
            const latest = yield* held
            if (DateTime.toEpochMillis(latest.expiresAt) > (yield* Clock.currentTimeMillis)) return
            yield* invalidateSelf
            return yield* Option.match(Option.fromNullishOr(failures.get(sessionId)), {
              onNone: () =>
                Effect.fail(
                  new Unavailable({
                    sessionId,
                    reason: "ren_unavailable",
                    message: "The access to the sandbox expired",
                  }),
                ),
              onSome: (failed) => Effect.fail(failed.error),
            })
          })
          return { connection: { hello, client, directory: access.directory }, ready }
        }).pipe(
          Scope.provide(attempt),
          Effect.onError(() => Scope.close(attempt, Exit.void)),
        )
      }),
    })
    return Service.of({
      connect: Effect.fn("HandConnections.connect")(function* (sessionId: Session.ID) {
        const entry = yield* RcMap.get(connections, sessionId).pipe(
          Effect.tapError(() => RcMap.invalidate(connections, sessionId)),
        )
        yield* entry.ready
        return entry.connection
      }),
    })
  }),
)
