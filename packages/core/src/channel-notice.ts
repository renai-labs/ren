export * as ChannelNotice from "./channel-notice.js"

import type { Channel } from "@ren/schema/channel"
import type { Session } from "@ren/schema/session"
import { Config, Context, Effect, Layer, Option } from "effect"
import { ChannelProvider } from "./channel-provider.js"

export interface Notice {
  readonly provider: Channel.Provider
  readonly target: ChannelProvider.Target
  readonly reason: Channel.FailureReason
  readonly sessionId?: Session.ID
}

export interface Interface {
  readonly notice: (notice: Notice) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ChannelNotice") {}

const textOf = (notice: Notice, app: string) => {
  const open = `[Open in Ren](${notice.sessionId ? `${app}/sessions/${notice.sessionId}` : `${app}/settings/channels`})`
  const texts: Readonly<Record<Channel.FailureReason, string>> = {
    unlinked: `Link your account to Ren so I can respond here. [Link your account](${app}/settings/preferences).`,
    not_member: "You need access to this channel’s space in Ren. Ask a space member to invite you.",
    fallback_gone: `I can’t respond here until this channel’s access is updated. Ask a space member to [update the channel settings](${app}/settings/channels/${notice.provider}).`,
    brain_failed: `I couldn’t start working on your message. Please try again. ${open}`,
    model_busy: `I’m temporarily unable to respond. Please try again in a minute. ${open}`,
    context_too_long: `This conversation is too long to continue. Please start a new thread. ${open}`,
    task_handoff: "Couldn’t hand this message to the task’s agent. Try again in a moment.",
    unknown: `Something went wrong while I was working on your message. Please try again. ${open}`,
  }
  return texts[notice.reason]
}

export const layerLog = Layer.succeed(
  Service,
  Service.of({
    notice: (notice) =>
      Effect.logWarning(`Channel notice ${notice.reason}`).pipe(
        Effect.annotateLogs({
          provider: notice.provider,
          install: notice.target.install,
          thread: notice.target.thread,
        }),
      ),
  }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* ChannelProvider.Registry
    const app = (yield* Config.String("APP_URL").pipe(Effect.orDie)).replace(/\/$/u, "")
    return Service.of({
      notice: Effect.fn("ChannelNotice.notice")(function* (notice: Notice) {
        const provider = registry.get(notice.provider)
        if (Option.isNone(provider))
          return yield* Effect.logWarning(`No channel provider ${notice.provider} posts notices`)
        yield* provider.value
          .send(notice.target, textOf(notice, app))
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(`A ${notice.provider} notice of ${notice.reason} could not be sent`, cause),
            ),
          )
      }),
    })
  }),
)
