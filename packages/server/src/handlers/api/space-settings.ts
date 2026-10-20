import { SpaceSettings } from "@ren/core/space/settings"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const SpaceSettingsHandler = HttpApiBuilder.group(Api, "space-settings", (handlers) =>
  Effect.gen(function* () {
    const settings = yield* SpaceSettings.Service
    return handlers
      .handle("space-settings.get", Primitive.get(settings.get))
      .handle("space-settings.update", Primitive.update(settings.update))
  }),
)
