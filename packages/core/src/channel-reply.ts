export * as ChannelReply from "./channel-reply.js"

import { Database } from "@ren/db/database"
import { Channel } from "@ren/schema/channel"
import { and, desc, eq, isNotNull } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schedule, Schema } from "effect"
import type { Actor } from "./actor.js"
import { ChannelProvider } from "./channel-provider.js"

export class Refused extends Schema.TaggedError<Refused>()("ChannelReply.Refused", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly reply: (actor: Actor.Info, input: Channel.ReplyInput) => Effect.Effect<Channel.Sent, Refused>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ChannelReply") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const registry = yield* ChannelProvider.Registry
    const thread = Database.Schema.channel_thread
    const session = Database.Schema.agent_session
    return Service.of({
      reply: Effect.fn("ChannelReply.reply")(function* (actor: Actor.Info, input: Channel.ReplyInput) {
        if (!actor.agent)
          return yield* new Refused({
            message: "Only the agent of a chat that came from a channel replies in its thread.",
          })
        const sessionId = actor.agent.sessionId
        const current = (yield* database.db
          .select({ parentId: session.parent_id })
          .from(session)
          .where(and(eq(session.id, sessionId), eq(session.organization_id, actor.organizationId)))
          .pipe(Effect.orDie)).at(0)
        if (!current) return yield* new Refused({ message: "This chat has no thread to reply to." })
        if (current.parentId) return yield* new Refused({ message: "Only the main agent replies in the thread." })
        const latest = (yield* database.db
          .select()
          .from(thread)
          .where(and(eq(thread.session_id, sessionId), isNotNull(thread.last_message_at)))
          .orderBy(desc(thread.last_message_at))
          .limit(1)
          .pipe(Effect.orDie)).at(0)
        if (!latest) return yield* new Refused({ message: "This chat has no thread to reply to." })
        const title = Channel.titles[latest.provider]
        const provider = registry.get(latest.provider)
        if (Option.isNone(provider))
          return yield* new Refused({ message: `${title} is not set up on this server, so the reply was not sent.` })
        const place = latest.place_name ?? latest.thread
        yield* provider.value
          .send(
            { install: latest.install, place, thread: latest.thread, message: latest.last_message ?? "" },
            input.text,
          )
          .pipe(
            Effect.retry({
              while: (error) => error._tag === "ChannelProvider.Unavailable",
              times: 3,
              schedule: Schedule.exponential("1 second"),
            }),
            Effect.catchTags({
              "ChannelProvider.PlaceGone": () =>
                Effect.fail(new Refused({ message: `The ${title} thread is gone, so the reply was not sent.` })),
              "ChannelProvider.Unavailable": () =>
                Effect.fail(
                  new Refused({ message: `${title} did not answer, so the reply was not sent. Try again later.` }),
                ),
              "ChannelProvider.Rejected": (error) =>
                Effect.fail(new Refused({ message: `${title} refused the reply: ${error.message}` })),
            }),
          )
        yield* database.db
          .update(thread)
          .set({ last_reply_at: new Date() })
          .where(eq(thread.id, latest.id))
          .pipe(Effect.orDie)
        return { provider: latest.provider, place } satisfies Channel.Sent
      }),
    })
  }),
)
