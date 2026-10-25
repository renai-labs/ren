import { RenInference } from "@ren/schema/ren-inference"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { ForbiddenError, InvalidRequestError, NotFoundError, UnavailableError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

const errors = [NotFoundError, ForbiddenError, InvalidRequestError, UnavailableError]

export const RenInferenceGroup = HttpApiGroup.make("ren-inference")
  .add(
    HttpApiEndpoint.post("ren-inference.connect", "/ren-inference/connect", {
      payload: RenInference.ConnectInput,
      success: RenInference.ConnectResult,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "ren-inference.connect",
        summary: "Start a provider sign-in",
        description:
          "Return the address of the Ren Inference Service sign-in page. Send the browser there; it comes back to `returnUrl`. Any member connects; the connection serves the whole organization.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("ren-inference.connection.list", "/ren-inference/connections", {
      success: Schema.Array(RenInference.Connection),
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "ren-inference.connection.list",
        summary: "List provider connections",
        description: "List the organization’s provider connections, with display data and usage meters.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("ren-inference.connection.rename", "/ren-inference/connections/:id", {
      params: { id: Schema.String },
      payload: RenInference.RenameInput,
      success: RenInference.Connection,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "ren-inference.connection.rename",
        summary: "Rename a provider connection",
        description:
          "Change the label of one connection. Only the member who connected it, admins and owners rename (`canManage`).",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("ren-inference.connection.remove", "/ren-inference/connections/:id", {
      params: { id: Schema.String },
      success: HttpApiSchema.NoContent,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "ren-inference.connection.remove",
        summary: "Remove a provider connection",
        description:
          "Remove one connection. New requests stop using it at once. Only the member who connected it, admins and owners remove (`canManage`).",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "ren-inference" }))
