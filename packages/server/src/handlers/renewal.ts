import { RenewalApi } from "@ren/brain-api/renewal-api"
import { BrainHost } from "@ren/core/brain-host"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

export const RenewalHandler = HttpApiBuilder.group(RenewalApi, "renewal", (handlers) =>
  Effect.gen(function* () {
    const brain = yield* BrainHost.Service
    return handlers.handle("renewal.models", (request) =>
      brain.renewModels(request.headers.authorization.replace(/^Bearer /u, "")),
    )
  }),
)
