import { OrganizationSettings } from "@ren/core/organization-settings"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const OrganizationSettingsHandler = HttpApiBuilder.group(Api, "organization-settings", (handlers) =>
  Effect.gen(function* () {
    const settings = yield* OrganizationSettings.Service
    return handlers
      .handle("organization-settings.get", Primitive.get(settings.get))
      .handle("organization-settings.update", Primitive.update(settings.update))
  }),
)
