import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Schema } from "effect"
import { ModelsBody } from "./brain-api.js"
import { ForbiddenError, ModelsUnavailableError } from "./errors.js"

const ModelsGroup = HttpApiGroup.make("models")
  .add(
    HttpApiEndpoint.post("models.refresh", "/brain/models/refresh", {
      headers: { authorization: Schema.String },
      success: ModelsBody,
      error: [ForbiddenError, ModelsUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "models.refresh",
        summary: "Refresh a brain’s models",
        description: "Grant fresh model access for the brain named by a host token, with a fresh host token.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "models" }))

export const ModelsApi = HttpApi.make("models")
  .add(ModelsGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren Models API",
      version: "0.0.0",
      description: "Internal API a session host calls to refresh its brain’s model access.",
    }),
  )
