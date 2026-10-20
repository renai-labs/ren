import { ForbiddenError } from "@ren/host-api/errors"
import { CurrentHost, RenHostApi } from "@ren/host-api/ren-host-api"
import { Settings } from "@ren/core/settings"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

export const HostSettingsHandler = HttpApiBuilder.group(RenHostApi, "settings", (handlers) =>
  Effect.gen(function* () {
    const settings = yield* Settings.Service
    return handlers.handle("settings.read", (request) =>
      Effect.gen(function* () {
        const host = yield* CurrentHost
        return yield* settings
          .read(host.sessionId, request.payload)
          .pipe(
            Effect.catchTag("Settings.NotFound", (error) =>
              Effect.fail(new ForbiddenError({ message: error.message })),
            ),
          )
      }),
    )
  }),
)
