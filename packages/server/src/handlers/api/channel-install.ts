import { ChannelInstalls } from "@ren/core/channel-installs"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const ChannelInstallHandler = HttpApiBuilder.group(Api, "channel-install", (handlers) =>
  Effect.gen(function* () {
    const installs = yield* ChannelInstalls.Service
    return handlers
      .handle("channel-install.list", Primitive.list(installs.list))
      .handle("channel-install.remove", Primitive.action(installs.remove))
  }),
)

export const ChannelConnectHandler = HttpApiBuilder.group(Api, "channel-connect", (handlers) =>
  Effect.gen(function* () {
    const installs = yield* ChannelInstalls.Service
    return handlers
      .handle("channel-provider.list", () => installs.providers)
      .handle("channel-install.start", Primitive.create(installs.start))
  }),
)
