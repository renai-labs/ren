import { ModelsApi } from "@ren/brain-api/models-api"
import { BrainHost } from "@ren/core/brain-host"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

export const ModelsHandler = HttpApiBuilder.group(ModelsApi, "models", (handlers) =>
  Effect.gen(function* () {
    const brain = yield* BrainHost.Service
    return handlers.handle("models.refresh", (request) =>
      brain.refreshModels(request.headers.authorization.replace(/^Bearer /u, "")),
    )
  }),
)
