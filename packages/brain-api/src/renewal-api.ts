import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Schema } from "effect"
import { ModelsBody } from "./brain-api.js"
import { ForbiddenError, ModelsUnavailableError } from "./errors.js"

const RenewalGroup = HttpApiGroup.make("renewal")
  .add(
    HttpApiEndpoint.post("renewal.models", "/brain/models/renew", {
      headers: { authorization: Schema.String },
      success: ModelsBody,
      error: [ForbiddenError, ModelsUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "renewal.models",
        summary: "Renew a brain’s models",
        description: "Grant fresh model access for the brain named by a renewal token, with a fresh renewal token.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "renewal" }))

export const RenewalApi = HttpApi.make("renewal")
  .add(RenewalGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren Renewal API",
      version: "0.0.0",
      description: "Internal API a session host calls to renew its brain’s model access.",
    }),
  )
