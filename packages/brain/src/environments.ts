export * as Environments from "./environments.js"

import { type Capability, type Hello, protocol } from "@ren/brain-api/executor-api"
import { ExecutorClient } from "@ren/brain-api/executor-client"
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
  Stream,
  SynchronizedRef,
} from "effect"
import { HttpClient } from "effect/http"
import { EnvironmentAccess } from "./environment-access.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("Environments.Unavailable", {
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
  readonly connect: (
    sessionId: Session.ID,
    capability: Capability,
  ) => Effect.Effect<Connection, Unavailable, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@ren/brain/Environments") {}

interface Entry {
  readonly connection: Connection
  readonly ready: Effect.Effect<void, Unavailable>
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const environmentAccess = yield* EnvironmentAccess.Service
    const http = yield* HttpClient.HttpClient
    const accesses = new Map<Session.ID, SynchronizedRef.SynchronizedRef<Environment.Access>>()
    const failures = new Map<Session.ID, { readonly error: Unavailable; readonly retryAtMs: number }>()

    const ask = Effect.fn("Environments.ask")(function* (sessionId: Session.ID) {
      const now = yield* Clock.currentTimeMillis
      const failed = failures.get(sessionId)
      if (failed?.error.reason === "ren_unavailable" && now < failed.retryAtMs) return yield* failed.error
      return yield* environmentAccess.open(sessionId).pipe(
        Effect.tap(() => Effect.sync(() => failures.delete(sessionId))),
        Effect.mapError((error) =>
          error._tag === "EnvironmentAccess.NotFound"
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
      lookup: Effect.fn("Environments.lookup")(function* (sessionId: Session.ID) {
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
          const refused = yield* Ref.make(false)
          const held = SynchronizedRef.updateAndGetEffect(current, (latest) =>
            Effect.gen(function* () {
              const isRefused = yield* Ref.getAndSet(refused, false)
              const now = yield* Clock.currentTimeMillis
              if (!isRefused && DateTime.toEpochMillis(latest.expiresAt) - now > Duration.toMillis(window))
                return latest
              return yield* ask(sessionId).pipe(
                Effect.flatMap((fresh) =>
                  isSameSandbox(latest, fresh)
                    ? Effect.succeed(fresh)
                    : RcMap.invalidate(connections, sessionId).pipe(Effect.as(latest)),
                ),
                Effect.catch((error) =>
                  error.reason === "no_access"
                    ? RcMap.invalidate(connections, sessionId).pipe(Effect.as(latest))
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
            renew: Ref.set(refused, true),
            onNoAnswer: RcMap.invalidate(connections, sessionId),
          }).pipe(Effect.provideService(HttpClient.HttpClient, http))
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
          if (hello.capabilities.includes("files"))
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
            yield* RcMap.invalidate(connections, sessionId)
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
    const apply = Effect.fn("Environments.apply")(function* (sessionId: Session.ID) {
      const current = accesses.get(sessionId)
      if (!current) return yield* RcMap.invalidate(connections, sessionId)
      const next = yield* environmentAccess.open(sessionId).pipe(Effect.option)
      const isReplaced = yield* SynchronizedRef.modify(current, (held): [boolean, Environment.Access] =>
        Option.match(next, {
          onNone: () => [true, held],
          onSome: (fresh) => (isSameSandbox(held, fresh) ? [false, fresh] : [true, held]),
        }),
      )
      if (isReplaced) yield* RcMap.invalidate(connections, sessionId)
    })
    yield* (yield* environmentAccess.subscribe).pipe(Stream.runForEach(apply), Effect.forkScoped)
    return Service.of({
      connect: Effect.fn("Environments.connect")(function* (sessionId: Session.ID, capability: Capability) {
        const entry = yield* RcMap.get(connections, sessionId).pipe(
          Effect.tapError(() => RcMap.invalidate(connections, sessionId)),
        )
        yield* entry.ready
        if (!entry.connection.hello.capabilities.includes(capability))
          return yield* new Unavailable({
            sessionId,
            reason: "incompatible",
            message: `The executor is not compatible: the sandbox does not support ${capability === "files" ? "file tools" : "shell commands"}`,
          })
        return entry.connection
      }),
    })
  }),
)
