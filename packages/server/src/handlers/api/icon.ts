import { Icons } from "@ren/core/icons"
import { InvalidRequestError, UnavailableError } from "@ren/protocol/errors"
import { Config, Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"

export const IconHandler = HttpApiBuilder.group(Api, "icon", (handlers) =>
  Effect.gen(function* () {
    const icons = yield* Icons.Service
    const baseURL = yield* Config.String("BETTER_AUTH_URL")
    return handlers.handle("icon.upload", (request) =>
      icons.store(request.payload).pipe(
        Effect.map((hash) => ({ url: new URL(`/icons/${hash}.webp`, baseURL).href })),
        Effect.catchTags({
          "Icons.Invalid": (error) => Effect.fail(new InvalidRequestError({ message: error.message, field: "file" })),
          "Icons.Unavailable": () =>
            Effect.fail(
              new UnavailableError({ message: "Icon storage did not answer. Try again.", retryAfterMs: 2000 }),
            ),
        }),
      ),
    )
  }),
)
