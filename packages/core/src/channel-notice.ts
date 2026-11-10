export * as ChannelNotice from "./channel-notice.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Channel } from "@ren/schema/channel"
import type { Session } from "@ren/schema/session"
import type { Task } from "@ren/schema/task"
import { and, eq, ne, sql } from "drizzle-orm"
import { Config, Context, Effect, Layer, Option } from "effect"
import { ChannelProvider } from "./channel-provider.js"
import { SlackTaskCard } from "./slack-task-card.js"

export interface Notice {
  readonly provider: Channel.Provider
  readonly target: ChannelProvider.Target
  readonly reason: Channel.FailureReason
  readonly sessionId?: Session.ID
}

export interface Review {
  readonly organizationId: Auth.OrganizationID
  readonly taskId: Task.ID
  readonly reason: string
  readonly sessionId?: Session.ID | undefined
}

export interface Interface {
  readonly notice: (notice: Notice) => Effect.Effect<void>
  readonly review: (review: Review) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ChannelNotice") {}

const textOf = (notice: Notice, app: string) => {
  const open = `[Open in Ren](${notice.sessionId ? `${app}/sessions/${notice.sessionId}` : `${app}/settings/channels`})`
  const texts: Readonly<Record<Channel.FailureReason, string>> = {
    unlinked: `Link your account to Ren so I can respond here. [Link your account](${app}/settings/preferences).`,
    not_member: "You need access to this channel’s space in Ren. Ask a space member to invite you.",
    fallback_gone: `I can’t respond here until this channel’s access is updated. Ask a space member to [update the channel settings](${app}/settings/channels/${notice.provider}).`,
    no_private_space:
      "I answer DMs in your private space in Ren, and you don’t have one. Mention me in a channel instead.",
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
    review: (review) =>
      Effect.logInfo(`Task review requested: ${review.reason}`).pipe(Effect.annotateLogs({ task: review.taskId })),
  }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const registry = yield* ChannelProvider.Registry
    const app = (yield* Config.String("APP_URL").pipe(Effect.orDie)).replace(/\/$/u, "")
    const thread = Database.Schema.intake_thread
    const link = Database.Schema.task_link
    const cards = yield* SlackTaskCard.Service
    const send = (provider: Channel.Provider, target: ChannelProvider.Target, text: string, about: string) =>
      Option.match(registry.get(provider), {
        onNone: () => Effect.logWarning(`No channel provider ${provider} posts notices`),
        onSome: (found) =>
          found
            .send(target, text)
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning(`A ${provider} notice of ${about} could not be sent`, cause),
              ),
            ),
      })
    const post = Effect.fnUntraced(function* (about: Review, text: string) {
      const threads = yield* database.db
        .selectDistinct({ thread: link.key })
        .from(link)
        .innerJoin(
          thread,
          and(
            eq(thread.organization_id, link.organization_id),
            eq(thread.origin, "slack"),
            eq(sql`upper(${thread.thread_key})`, link.key),
          ),
        )
        .where(
          and(
            eq(link.task_id, about.taskId),
            eq(link.organization_id, about.organizationId),
            eq(link.kind, "slack_thread"),
            about.sessionId ? ne(thread.current_session_id, about.sessionId) : undefined,
          ),
        )
        .pipe(Effect.orDie)
      yield* Effect.forEach(
        threads,
        (found) =>
          cards.post({ organizationId: about.organizationId, taskId: about.taskId, thread: found.thread, text }),
        { discard: true },
      )
    })
    return Service.of({
      notice: Effect.fn("ChannelNotice.notice")(function* (notice: Notice) {
        yield* send(notice.provider, notice.target, textOf(notice, app), notice.reason)
      }),
      review: Effect.fn("ChannelNotice.review")(function* (review: Review) {
        yield* post(review, `Needs review: ${review.reason} [Open the task](${app}/tasks/${review.taskId})`)
      }),
    })
  }),
)
