export * as ChannelReply from "./channel-reply.js"

import { Database } from "@ren/db/database"
import { Channel } from "@ren/schema/channel"
import type { Session } from "@ren/schema/session"
import { and, desc, eq, isNotNull } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schedule, Schema } from "effect"
import { ChannelProvider } from "./channel-provider.js"

export class Refused extends Schema.TaggedError<Refused>()("ChannelReply.Refused", {
  message: Schema.String,
}) {}

export interface Sent {
  readonly provider: Channel.Provider
  readonly place: string
}

export interface Interface {
  readonly reply: (sessionId: Session.ID, text: string) => Effect.Effect<Sent, Refused>
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
      reply: Effect.fn("ChannelReply.reply")(function* (sessionId: Session.ID, text: string) {
        const sessions = yield* database.db
          .select({ parentId: session.parent_id })
          .from(session)
          .where(eq(session.id, sessionId))
          .pipe(Effect.orDie)
        if (sessions.at(0)?.parentId)
          return yield* new Refused({ message: "Only the main agent replies in the thread." })
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
          .send({ install: latest.install, place, thread: latest.thread, message: latest.last_message ?? "" }, text)
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
        return { provider: latest.provider, place }
      }),
    })
  }),
)
