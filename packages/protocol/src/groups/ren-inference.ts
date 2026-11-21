import { RenInference } from "@ren/schema/ren-inference"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { ConflictError, ForbiddenError, InvalidRequestError, NotFoundError, UnavailableError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

const errors = [NotFoundError, ForbiddenError, InvalidRequestError, ConflictError, UnavailableError]

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
  .add(
    HttpApiEndpoint.get("ren-inference.key.list", "/ren-inference/keys", {
      success: RenInference.KeyList,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "ren-inference.key.list",
        summary: "List inference keys",
        description:
          "List the inference keys that the caller may see, newest first: owners and admins see every key of the organization, members see their own.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("ren-inference.key.usage", "/ren-inference/keys/usage", {
      query: Schema.Struct({ period: RenInference.Period }),
      success: Schema.Array(RenInference.KeyUsage),
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "ren-inference.key.usage",
        summary: "Read inference key usage",
        description:
          "Return the calls, tokens and charges of each key that the caller may see and that has calls in the period.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("ren-inference.key.create", "/ren-inference/keys", {
      payload: RenInference.CreateKeyInput,
      success: RenInference.CreatedKey,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "ren-inference.key.create",
        summary: "Create an inference key",
        description: "Create a key for the caller and return its secret and the base URL. Any member creates keys.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("ren-inference.key.revoke", "/ren-inference/keys/:id", {
      params: { id: Schema.String },
      success: HttpApiSchema.NoContent,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "ren-inference.key.revoke",
        summary: "Revoke an inference key",
        description:
          "Revoke one key. Calls with it stop at once. Members revoke their own keys; owners and admins revoke any key. Revoking a revoked or expired key succeeds.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("ren-inference.key.secret", "/ren-inference/keys/:id/secret", {
      params: { id: Schema.String },
      success: RenInference.KeySecret,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "ren-inference.key.secret",
        summary: "Read an inference key",
        description:
          "Return the secret of one of the caller’s own active keys and the base URL. Only the owner reads a secret.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("ren-inference.harness-plan", "/ren-inference/harness-plans", {
      payload: RenInference.HarnessPlanInput,
      success: RenInference.HarnessPlan,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "ren-inference.harness-plan",
        summary: "Plan a harness setup",
        description:
          "Return the config edits that point a harness at Ren’s models, from the organization’s live model list. The plan holds `${REN_INFERENCE_KEY}` where the key goes.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "ren-inference" }))
