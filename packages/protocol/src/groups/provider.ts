import { ProviderCard } from "@ren/schema/provider-card"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ForbiddenError, InvalidRequestError, NotFoundError, UnavailableError } from "../errors.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

const errors = [NotFoundError, ForbiddenError, InvalidRequestError, UnavailableError]

const ProviderParams = { id: Schema.NonEmptyString }

export const ProviderGroup = HttpApiGroup.make("provider")
  .add(
    HttpApiEndpoint.get("provider.list", "/providers", { success: ProviderCard.Page, error: errors }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.list",
        summary: "List the organization’s providers",
        description:
          "Ren’s card, the cards the organization added (own keys and subscriptions), and every provider it can add, with model counts from models.dev. Every member reads it.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("provider.update", "/providers/:id", {
      params: ProviderParams,
      payload: ProviderCard.UpdateInput,
      success: ProviderCard.Page,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.update",
        summary: "Turn a provider on or off, or change its method",
        description:
          "Change one card. `ren` is Ren’s card. Off removes the card’s models from pickers at the next push. Only admins and owners.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("provider.test", "/providers/:id/test", {
      params: ProviderParams,
      payload: ProviderCard.KeyInput,
      success: ProviderCard.TestResult,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.test",
        summary: "Test a provider key",
        description:
          "Send one small request with the fields, through the model gateway, and save nothing. A failed test returns the vendor’s message. Only admins and owners.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("provider.key.save", "/providers/:id/key", {
      params: ProviderParams,
      payload: ProviderCard.KeyInput,
      success: ProviderCard.Page,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.key.save",
        summary: "Save a provider key",
        description:
          "Test the fields, then store them in the model gateway. Ren keeps the last 4 characters and never stores or logs the key. A failed test saves nothing (400 with the vendor’s message). Only admins and owners.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("provider.key.remove", "/providers/:id/key", {
      params: ProviderParams,
      success: ProviderCard.Page,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.key.remove",
        summary: "Remove a provider key",
        description:
          "Remove the key from the model gateway. The next call with the provider’s models fails. Only admins and owners.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("provider.ren-models.list", "/providers/ren/models", {
      success: ProviderCard.RenModels,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.ren-models.list",
        summary: "List Ren’s models",
        description: "Each of Ren’s models with its price per 1M tokens, whether it is free, and whether it is on.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("provider.ren-models.update", "/providers/ren/models", {
      payload: ProviderCard.RenModelsInput,
      success: ProviderCard.RenModels,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "provider.ren-models.update",
        summary: "Turn Ren’s models on or off",
        description:
          "Switch models on or off, and set whether new models start on. A model that is off leaves pickers at the next push. Only admins and owners.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
