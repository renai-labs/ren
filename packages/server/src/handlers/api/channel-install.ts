import { ChannelInstalls } from "@ren/core/channel-installs"
import { ChannelMappings } from "@ren/core/channel-mappings"
import { NotFoundError, UnavailableError } from "@ren/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const ChannelInstallHandler = HttpApiBuilder.group(Api, "channel-install", (handlers) =>
  Effect.gen(function* () {
    const installs = yield* ChannelInstalls.Service
    return handlers
      .handle("channel-install.list", Primitive.list(installs.list))
      .handle("channel-install.update", Primitive.update(installs.update))
      .handle("channel-install.remove", Primitive.action(installs.remove))
  }),
)

export const ChannelMappingHandler = HttpApiBuilder.group(Api, "channel-mapping", (handlers) =>
  Effect.gen(function* () {
    const mappings = yield* ChannelMappings.Service
    return handlers
      .handle("channel-mapping.list", Primitive.list(mappings.list))
      .handle("channel-mapping.create", Primitive.create(mappings.create))
      .handle("channel-mapping.remove", Primitive.action(mappings.remove))
  }),
)

export const ChannelConnectHandler = HttpApiBuilder.group(Api, "channel-connect", (handlers) =>
  Effect.gen(function* () {
    const installs = yield* ChannelInstalls.Service
    const mappings = yield* ChannelMappings.Service
    return handlers
      .handle("channel-provider.list", () => installs.providers)
      .handle("channel-install.start", Primitive.create(installs.start))
      .handle("channel-place.list", (request) =>
        Effect.flatMap(Primitive.currentActor, (actor) => mappings.places(actor, request.query)).pipe(
          Effect.catchTags({
            "Primitive.NotFound": (error) => Effect.fail(new NotFoundError({ message: error.message })),
            "ChannelProvider.Unavailable": (error) =>
              Effect.logWarning("The places of an install could not be read", error).pipe(
                Effect.andThen(
                  Effect.fail(
                    new UnavailableError({ message: "The provider did not answer. Try again.", retryAfterMs: 5000 }),
                  ),
                ),
              ),
          }),
        ),
      )
  }),
)
