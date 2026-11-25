import { Provider } from "@ren/schema/provider"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { ForbiddenError, InvalidRequestError, NotFoundError, UnavailableError } from "../errors.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

const errors = [NotFoundError, ForbiddenError, InvalidRequestError, UnavailableError]

const ProviderParams = { id: Schema.NonEmptyString }

export const ProviderGroup = HttpApiGroup.make("provider")
  .add(
    HttpApiEndpoint.get("provider.list", "/providers", { success: Provider.Page, error: errors }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.list",
        summary: "List the organization’s providers",
        description:
          "The built-in providers, the providers the organization added, and every provider it can add, with its model count. Every member reads it.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("provider.update", "/providers/:id", {
      params: ProviderParams,
      payload: Provider.UpdateInput,
      success: HttpApiSchema.NoContent,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.update",
        summary: "Turn a provider on or off, or change its method",
        description:
          "Change one provider. Off removes the provider’s models from pickers at the next push. Only admins and owners.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("provider.test", "/providers/:id/test", {
      params: ProviderParams,
      payload: Provider.KeyInput,
      success: Provider.TestResult,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.test",
        summary: "Test a provider key",
        description:
          "Send one small request with the fields, through the provider’s inference service, and save nothing. A failed test returns the vendor’s message. Only admins and owners.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("provider.key.save", "/providers/:id/key", {
      params: ProviderParams,
      payload: Provider.KeyInput,
      success: HttpApiSchema.NoContent,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.key.save",
        summary: "Save a provider key",
        description:
          "Test the fields, then store them in the provider’s inference service. Ren keeps the last 4 characters and never stores or logs the key. A failed test saves nothing (400 with the vendor’s message). Only admins and owners.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("provider.key.remove", "/providers/:id/key", {
      params: ProviderParams,
      success: HttpApiSchema.NoContent,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.key.remove",
        summary: "Remove a provider key",
        description:
          "Remove the key from the provider’s inference service. The provider’s models leave pickers at the next push. Only admins and owners.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("provider.models.list", "/providers/:id/models", {
      params: ProviderParams,
      success: Provider.ModelList,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.models.list",
        summary: "List a provider’s models",
        description:
          "Each of the provider’s models with its price per 1M tokens, whether it is free, and whether it is on. A new model is always on.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("provider.models.update", "/providers/:id/models", {
      params: ProviderParams,
      payload: Provider.ModelListInput,
      success: HttpApiSchema.NoContent,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.models.update",
        summary: "Turn a provider’s models on or off",
        description:
          "Switch the listed models on or off; the others keep their state. A model that is off leaves pickers at the next push. Only admins and owners.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
