export * as Environments from "./environments.js"

import { type Capability, type Hello, protocol } from "@ren/brain-api/executor-api"
import { ExecutorClient } from "@ren/brain-api/executor-client"
import { Environment } from "@ren/schema/environment"
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
  Schema,
  Scope,
  Stream,
  SynchronizedRef,
} from "effect"
import { HttpClient } from "effect/http"
import { EnvironmentAccess } from "./environment-access.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("Environments.Unavailable", {
  environmentId: Environment.ID,
  reason: Schema.Literals(["not_found", "unreachable", "incompatible"]),
  message: Schema.String,
}) {}

const capabilities = ["processes", "files"] as const satisfies ReadonlyArray<Capability>

export const refreshBefore = Duration.minutes(5)

export interface Connection {
  readonly hello: Hello
  readonly client: ExecutorClient.Client
}

export interface Interface {
  readonly connect: (id: Environment.ID) => Effect.Effect<Connection, Unavailable, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@ren/brain/Environments") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const environmentAccess = yield* EnvironmentAccess.Service
    const http = yield* HttpClient.HttpClient
    const accesses = new Map<Environment.ID, SynchronizedRef.SynchronizedRef<Environment.Access>>()
    const connections = yield* RcMap.make({
      idleTimeToLive: Duration.infinity,
      lookup: Effect.fn("Environments.lookup")(function* (id: Environment.ID) {
        const entryScope = yield* Effect.scope
        const attempt = yield* Scope.fork(entryScope)
        return yield* Effect.gen(function* () {
          const access = yield* environmentAccess.open(id).pipe(
            Effect.mapError(
              () =>
                new Unavailable({
                  environmentId: id,
                  reason: "not_found",
                  message: `No access to environment ${id}`,
                }),
            ),
          )
          const current = yield* SynchronizedRef.make(access)
          accesses.set(id, current)
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (accesses.get(id) === current) accesses.delete(id)
            }),
          )
          const token = SynchronizedRef.updateAndGetEffect(current, (held) =>
            Clock.currentTimeMillis.pipe(
              Effect.flatMap((now) =>
                DateTime.toEpochMillis(held.expiresAt) - now > Duration.toMillis(refreshBefore)
                  ? Effect.succeed(held)
                  : environmentAccess
                      .open(id)
                      .pipe(
                        Effect.catch((error) =>
                          Effect.logWarning(`Could not refresh access to environment ${id}: ${error._tag}`).pipe(
                            Effect.as(held),
                          ),
                        ),
                      ),
              ),
            ),
          ).pipe(Effect.map((held) => held.token))
          const client = yield* ExecutorClient.make({ url: access.url, token }).pipe(
            Effect.provideService(HttpClient.HttpClient, http),
          )
          const hello = yield* client["executor.hello"]().pipe(
            Effect.mapError(
              (cause) =>
                new Unavailable({
                  environmentId: id,
                  reason: "unreachable",
                  message: `The executor at ${access.url} did not answer: ${cause.message}`,
                }),
            ),
          )
          if (hello.protocol !== protocol)
            return yield* new Unavailable({
              environmentId: id,
              reason: "incompatible",
              message: `The executor speaks protocol ${hello.protocol}, not ${protocol}`,
            })
          const missing = capabilities.filter((capability) => !hello.capabilities.includes(capability))
          if (missing.length > 0)
            return yield* new Unavailable({
              environmentId: id,
              reason: "incompatible",
              message: `The executor lacks the capabilities ${missing.join(", ")}`,
            })
          return { hello, client }
        }).pipe(
          Scope.provide(attempt),
          Effect.onError(() => Scope.close(attempt, Exit.void)),
        )
      }),
    })
    const apply = Effect.fn("Environments.apply")(function* (id: Environment.ID) {
      const current = accesses.get(id)
      if (!current) return yield* RcMap.invalidate(connections, id)
      const next = yield* environmentAccess.open(id).pipe(Effect.option)
      const isReplaced = yield* SynchronizedRef.modify(current, (held): [boolean, Environment.Access] =>
        Option.match(next, {
          onNone: () => [true, held],
          onSome: (fresh) =>
            fresh.url === held.url && fresh.generation === held.generation ? [false, fresh] : [true, held],
        }),
      )
      if (isReplaced) yield* RcMap.invalidate(connections, id)
    })
    yield* (yield* environmentAccess.subscribe).pipe(Stream.runForEach(apply), Effect.forkScoped)
    return Service.of({
      connect: Effect.fn("Environments.connect")(function* (id: Environment.ID) {
        return yield* RcMap.get(connections, id).pipe(Effect.tapError(() => RcMap.invalidate(connections, id)))
      }),
    })
  }),
)
