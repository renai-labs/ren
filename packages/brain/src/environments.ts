export * as Environments from "./environments.js"

import { type Capability, type Hello, protocol } from "@ren/brain-api/executor-api"
import { ExecutorClient } from "@ren/brain-api/executor-client"
import { Environment } from "@ren/schema/environment"
import { Context, Duration, Effect, Exit, Layer, Schema, Scope, ScopedCache } from "effect"
import { HttpClient } from "effect/http"
import { EnvironmentAccess } from "./environment-access.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("Environments.Unavailable", {
  environmentId: Environment.ID,
  reason: Schema.Literals(["not_found", "unreachable", "incompatible"]),
  message: Schema.String,
}) {}

const capabilities = ["processes", "files"] as const satisfies ReadonlyArray<Capability>

export interface Connection {
  readonly access: Environment.Access
  readonly hello: Hello
  readonly client: ExecutorClient.Client
}

export interface Interface {
  readonly connect: (id: Environment.ID) => Effect.Effect<Connection, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/brain/Environments") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const environmentAccess = yield* EnvironmentAccess.Service
    const http = yield* HttpClient.HttpClient
    const cache = yield* ScopedCache.makeWith<Environment.ID, Connection, Unavailable>({
      capacity: Infinity,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
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
          const client = yield* ExecutorClient.make({ url: access.url, token: access.token }).pipe(
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
          return { access, hello, client }
        }).pipe(
          Scope.provide(attempt),
          Effect.onError(() => Scope.close(attempt, Exit.void)),
        )
      }),
    })
    return Service.of({
      connect: Effect.fn("Environments.connect")(function* (id: Environment.ID) {
        return yield* ScopedCache.get(cache, id)
      }),
    })
  }),
)
