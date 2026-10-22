import { CurrentHost, RenHostApi } from "@ren/host-api/ren-host-api"
import { BrainHost } from "@ren/core/brain-host"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

export const HostPullHandler = HttpApiBuilder.group(RenHostApi, "pull", (handlers) =>
  Effect.gen(function* () {
    const brain = yield* BrainHost.Service
    return handlers.handle("pull", (request) =>
      Effect.gen(function* () {
        const host = yield* CurrentHost
        return yield* brain.pull(host, request.payload)
      }),
    )
  }),
)
