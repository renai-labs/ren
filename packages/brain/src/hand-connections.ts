export * as HandConnections from "./hand-connections.js"

import { type Hello, protocol } from "@ren/hand-api/executor-api"
import { ExecutorClient } from "@ren/hand-api/executor-client"
import type { Hand } from "@ren/schema/hand"
import { Session } from "@ren/schema/session"
import {
  Cache,
  Cause,
  Clock,
  Context,
  DateTime,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  RcMap,
  Redacted,
  Ref,
  Schema,
  Scope,
  SynchronizedRef,
} from "effect"
import { HttpClient } from "effect/http"
import { HandAccess } from "./hand-access.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("HandConnections.Unavailable", {
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
  if (ExecutorClient.isNoAnswer(value) && value instanceof Error)
    return { message: `The hand does not answer: ${value.message}` }
  return undefined
}

export const refreshBefore = Duration.minutes(5)

export const retryRenAfter = Duration.seconds(30)

const isSameHand = (held: Hand.Access, fresh: Hand.Access) =>
  fresh.url.href === held.url.href && fresh.generation === held.generation && fresh.directory === held.directory

export interface Connection {
  readonly hello: Hello
  readonly client: ExecutorClient.Client
}

export interface Interface {
  readonly connect: (sessionId: Session.ID) => Effect.Effect<Connection, Unavailable, Scope.Scope>
  readonly release: (sessionId: Session.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/brain/HandConnections") {}

interface Entry {
  readonly connection: Connection
  readonly checkAccess: Effect.Effect<void, Unavailable>
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const handAccess = yield* HandAccess.Service
    const http = yield* HttpClient.HttpClient
    const liveEntries = new Map<Session.ID, SynchronizedRef.SynchronizedRef<Hand.Access>>()
    const lastFailures = yield* Cache.makeWith(
      Effect.fn("HandConnections.openAccess")(function* (sessionId: Session.ID) {
        return yield* handAccess.open(sessionId).pipe(
          Effect.mapError((error) =>
            error._tag === "HandAccess.NotFound"
              ? new Unavailable({ sessionId, reason: "no_access", message: `No access to a hand: ${error.message}` })
              : new Unavailable({
                  sessionId,
                  reason: "ren_unavailable",
                  message: `Ren does not answer: ${error.message}`,
                }),
          ),
        )
      }),
      {
        capacity: Number.POSITIVE_INFINITY,
        timeToLive: (exit) =>
          Exit.isFailure(exit) &&
          Option.exists(Cause.findErrorOption(exit.cause), (error) => error.reason === "ren_unavailable")
            ? retryRenAfter
            : Duration.zero,
      },
    )
    const openAccess = (sessionId: Session.ID) => Cache.get(lastFailures, sessionId)

    const connections: RcMap.RcMap<Session.ID, Entry, Unavailable> = yield* RcMap.make({
      idleTimeToLive: Duration.infinity,
      lookup: Effect.fn("HandConnections.lookup")(function* (sessionId: Session.ID) {
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
                  isSameHand(latest, fresh) ? Effect.succeed(fresh) : invalidateSelf.pipe(Effect.as(latest)),
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
            token: Effect.map(freshAccess, (latest) => Redacted.value(latest.token)),
            onNoAnswer: invalidateSelf,
            onRefused: (token) => Ref.set(refusedToken, token),
          }).pipe(Effect.provideService(HttpClient.HttpClient, http))
          const unreachableBecause = (cause: { readonly _tag: string; readonly message: string }) =>
            cause._tag === "UnauthorizedError"
              ? new Unavailable({
                  sessionId,
                  reason: "token_refused",
                  message: `The hand at ${access.url} refused the access token from Ren`,
                })
              : new Unavailable({
                  sessionId,
                  reason: "unreachable",
                  message: `The hand at ${access.url} does not answer: ${cause.message}`,
                })
          const hello = yield* client["executor.hello"]().pipe(Effect.mapError(unreachableBecause))
          if (hello.protocol !== protocol)
            return yield* new Unavailable({
              sessionId,
              reason: "incompatible",
              message: `The executor is not compatible: it speaks protocol ${hello.protocol}, not ${protocol}`,
            })
          yield* client["files.mkdir"]({ path: access.directory }).pipe(
            Effect.mapError((error) =>
              error._tag === "FileSystemError"
                ? new Unavailable({
                    sessionId,
                    reason: "directory_failed",
                    message: `Could not make the directory ${access.directory} on the hand: ${error.message}`,
                  })
                : unreachableBecause(error),
            ),
          )
          const checkAccess: Effect.Effect<void, Unavailable> = Effect.gen(function* () {
            const latest = yield* freshAccess
            if (DateTime.toEpochMillis(latest.expiresAt) > (yield* Clock.currentTimeMillis)) return
            yield* invalidateSelf
            yield* Cache.getOption(lastFailures, sessionId)
            return yield* new Unavailable({
              sessionId,
              reason: "ren_unavailable",
              message: "The access to the hand expired",
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
      connect: Effect.fn("HandConnections.connect")(function* (sessionId: Session.ID) {
        const entry = yield* RcMap.get(connections, sessionId).pipe(
          Effect.tapError(() => RcMap.invalidate(connections, sessionId)),
        )
        yield* entry.checkAccess
        return entry.connection
      }),
      release: Effect.fn("HandConnections.release")(function* (sessionId: Session.ID) {
        yield* RcMap.invalidate(connections, sessionId)
        yield* handAccess
          .release(sessionId)
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning(`Could not release the hand seat of session ${sessionId}: ${error.message}`),
            ),
          )
      }),
    })
  }),
)
