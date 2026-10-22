import { CurrentHost, RenHostApi } from "@ren/host-api/ren-host-api"
import { BrainHost } from "@ren/core/brain-host"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

export const HostEnvironmentsHandler = HttpApiBuilder.group(RenHostApi, "environments", (handlers) =>
  Effect.gen(function* () {
    const brain = yield* BrainHost.Service
    return handlers
      .handle("environments.access", (request) =>
        Effect.gen(function* () {
          const host = yield* CurrentHost
          return yield* brain.accessEnvironment(host, request.params.id)
        }),
      )
      .handle("environments.release", (request) =>
        Effect.gen(function* () {
          const host = yield* CurrentHost
          yield* brain.releaseEnvironment(host, request.params.id)
        }),
      )
  }),
)
