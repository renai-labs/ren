import { CurrentHost, RenHostApi } from "@ren/host-api/ren-host-api"
import { BrainHost } from "@ren/core/brain-host"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

export const HostModelsHandler = HttpApiBuilder.group(RenHostApi, "models", (handlers) =>
  Effect.gen(function* () {
    const brain = yield* BrainHost.Service
    return handlers.handle("models.refresh", () =>
      Effect.gen(function* () {
        const host = yield* CurrentHost
        return yield* brain.refreshModels(host)
      }),
    )
  }),
)
