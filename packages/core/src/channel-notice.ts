export * as ChannelNotice from "./channel-notice.js"

import type { Channel } from "@ren/schema/channel"
import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly notice: (event: Channel.Event, reason: Channel.FailureReason) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ChannelNotice") {}

export const layerLog = Layer.succeed(
  Service,
  Service.of({
    notice: (event, reason) =>
      Effect.logWarning(`Channel notice ${reason}`).pipe(
        Effect.annotateLogs({ provider: event.provider, install: event.install, thread: event.thread.id }),
      ),
  }),
)
