import { CurrentHost, HostApi } from "@ren/brain-api/host-api"
import { BrainHost } from "@ren/core/brain-host"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

export const HostEnvironmentsHandler = HttpApiBuilder.group(HostApi, "environments", (handlers) =>
  Effect.gen(function* () {
    const brain = yield* BrainHost.Service
    return handlers.handle("environments.access", () =>
      Effect.gen(function* () {
        const host = yield* CurrentHost
        return yield* brain.accessEnvironment(host)
      }),
    )
  }),
)
