export * as SlackBot from "./slack-bot.js"

import { Database } from "@ren/db/database"
import { HostMcp } from "@ren/host-api/host-mcp"
import type { Auth } from "@ren/schema/auth"
import { Channel } from "@ren/schema/channel"
import { Drive } from "@ren/schema/drive"
import type { Space } from "@ren/schema/space"
import { and, desc, eq, isNotNull } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option, type Redacted, Schedule, Schema } from "effect"
import type { Actor } from "./actor.js"
import { ChannelInstallQueries } from "./channel-install/queries.js"
import { ChannelProvider } from "./channel-provider.js"
import { Drives } from "./drives.js"
import { Slack } from "./channel-provider/slack.js"
import { SlackApp } from "./slack-app.js"

export class Refused extends Schema.TaggedError<Refused>()("SlackBot.Refused", {
  message: Schema.String,
}) {}

export interface Tool {
  readonly name: string
  readonly description: string
  readonly input: Schema.Top
  readonly posts: boolean
}

export interface Interface {
  readonly tools: ReadonlyArray<Tool>
  readonly enabled: (organizationId: Auth.OrganizationID, spaceId: Space.ID) => Effect.Effect<boolean>
  readonly call: (actor: Actor.AgentInfo, name: string, args: unknown) => Effect.Effect<unknown, Refused>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SlackBot") {}

interface Connection {
  readonly actor: Actor.AgentInfo
  readonly workspace: string
  readonly token: Redacted.Redacted
  readonly client: SlackApp.Client
}

type Run = (connection: Connection, args: unknown) => Effect.Effect<unknown, Refused | SlackApp.Failed>

interface Defined extends Tool {
  readonly run: Run
}

const ChannelId = Schema.NonEmptyString.annotate({ description: "Slack channel ID, e.g. C0123ABCD" })

const Ts = Schema.NonEmptyString.annotate({ description: "Slack message timestamp, e.g. 1712345678.000100" })

const Text = Schema.NonEmptyString.annotate({ description: "Message body; Markdown is converted for Slack" })

const Charts = Schema.optionalKey(
  Schema.Array(Channel.Chart).annotate({
    description:
      "Native Slack charts under the text, at most 2. Ren repairs a chart that does not fit Slack, or leaves it out and says why.",
  }),
)

const UncheckedCharts = Schema.optionalKey(Schema.Array(Schema.Unknown))

const withCharts = <Fields extends Schema.Struct.Fields>(fields: Fields) => ({
  input: Schema.Struct({ ...fields, charts: UncheckedCharts }),
  shown: Schema.Struct({ ...fields, charts: Charts }),
})

const Limit = Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 })))

const Cursor = Schema.optionalKey(Schema.String.annotate({ description: "The nextCursor of the previous page" }))

const Posted = Schema.Struct({ channel: Schema.optionalKey(Schema.String), ts: Schema.String })

const Message = Schema.Struct({
  ts: Schema.optionalKey(Schema.String),
  user: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
  files: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        name: Schema.optionalKey(Schema.String),
        title: Schema.optionalKey(Schema.String),
        mimetype: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
})

const Next = Schema.optionalKey(Schema.Struct({ next_cursor: Schema.optionalKey(Schema.String) }))

const Messages = Schema.Struct({ messages: Schema.optionalKey(Schema.Array(Message)), response_metadata: Next })

const Reactions = Schema.Struct({
  message: Schema.optionalKey(
    Schema.Struct({
      reactions: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            name: Schema.String,
            count: Schema.Number,
            users: Schema.optionalKey(Schema.Array(Schema.String)),
          }),
        ),
      ),
    }),
  ),
})

const Member = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  real_name: Schema.optionalKey(Schema.String),
  deleted: Schema.optionalKey(Schema.Boolean),
  is_bot: Schema.optionalKey(Schema.Boolean),
  is_admin: Schema.optionalKey(Schema.Boolean),
  profile: Schema.optionalKey(Schema.Struct({ email: Schema.optionalKey(Schema.String) })),
})

const UserInfo = Schema.Struct({ user: Member })

const Members = Schema.Struct({ members: Schema.Array(Member), response_metadata: Next })

const UploadUrl = Schema.Struct({ upload_url: Schema.String, file_id: Schema.String })

const Ok = Schema.Struct({})

const posting = HostMcp.channelServers.slack?.posting ?? []

const ignoredReactions = new Set(["already_reacted", "no_reaction"])

const dmRefusal = "This is a shared space; Ren can’t use Slack DMs from here. Use the space’s mapped channels."

const disconnected = new Refused({
  message: "Slack is not connected to this space. Map a Slack channel to it in Settings → Channels.",
})

const messagesOf = (answer: typeof Messages.Type) =>
  (answer.messages ?? []).map((found) => ({
    ts: found.ts ?? null,
    userId: found.user ?? null,
    text: found.text ?? "",
    files: (found.files ?? []).map((file) => ({
      name: file.name || file.title || "untitled",
      mime: file.mimetype || "application/octet-stream",
    })),
  }))

const userOf = (member: typeof Member.Type) => ({
  slackUserId: member.id,
  name: member.real_name ?? member.name ?? null,
  email: member.profile?.email ?? null,
})

const define = <A>(
  name: string,
  options: { readonly input: Schema.Codec<A, unknown>; readonly shown?: Schema.Top; readonly description: string },
  run: (connection: Connection, input: A) => Effect.Effect<unknown, Refused | SlackApp.Failed>,
): Defined => ({
  name,
  description: options.description,
  input: options.shown ?? options.input,
  posts: posting.includes(name),
  run: (connection, args) =>
    Schema.decodeUnknownEffect(options.input)(args).pipe(
      Effect.mapError((error) => new Refused({ message: `The arguments of ${name} are not valid: ${error.message}` })),
      Effect.flatMap((input) => run(connection, input)),
    ),
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const slack = yield* SlackApp.Service
    const registry = yield* ChannelProvider.Registry
    const drives = yield* Drives.Service
    const thread = Database.Schema.channel_thread
    const spaces = Database.Schema.space
    const accounts = Database.Schema.account

    const enabled = (organizationId: Auth.OrganizationID, spaceId: Space.ID) =>
      database
        .transaction((transaction) => ChannelInstallQueries.servers(transaction, organizationId, spaceId))
        .pipe(
          Effect.orDie,
          Effect.map((servers) => servers.includes("slack")),
        )

    const connect = Effect.fnUntraced(function* (actor: Actor.AgentInfo) {
      if (Option.isNone(slack.client)) return yield* new Refused({ message: "Slack is not set up on this Ren server." })
      if (!(yield* enabled(actor.organizationId, actor.agent.spaceId))) return yield* disconnected
      const install = yield* slack.installOf(actor.organizationId)
      if (Option.isNone(install)) return yield* disconnected
      return {
        actor,
        workspace: install.value.workspace,
        token: install.value.secret,
        client: slack.client.value,
      } satisfies Connection
    })

    const shared = (spaceId: Space.ID) =>
      database.db
        .select({ kind: spaces.kind })
        .from(spaces)
        .where(eq(spaces.id, spaceId))
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows.at(0)?.kind !== "private"),
        )

    const reachable = (connection: Connection, channelId: string) =>
      channelId.startsWith("D")
        ? Effect.flatMap(shared(connection.actor.agent.spaceId), (isShared) =>
            isShared ? Effect.fail(new Refused({ message: dmRefusal })) : Effect.void,
          )
        : Effect.void

    const bind = (connection: Connection, channel: string, root: string) =>
      database.db
        .insert(thread)
        .values({
          id: Channel.ThreadID.create(),
          organization_id: connection.actor.organizationId,
          provider: "slack",
          install: connection.workspace,
          thread: `${channel}:${root}`,
          session_id: connection.actor.agent.sessionId,
        })
        .onConflictDoNothing()
        .pipe(Effect.orDie)

    const post = Effect.fnUntraced(function* (
      connection: Connection,
      input: {
        readonly channelId: string
        readonly threadTs?: string
        readonly text: string
        readonly charts?: ReadonlyArray<unknown>
      },
    ) {
      yield* reachable(connection, input.channelId)
      const sent = yield* Slack.post(input.text, input.charts ?? [], (payload) =>
        connection.client.post(
          "chat.postMessage",
          {
            channel: input.channelId,
            ...(input.threadTs && { thread_ts: input.threadTs }),
            unfurl_links: false,
            ...payload,
          },
          Posted,
          connection.token,
        ),
      )
      yield* bind(connection, input.channelId, input.threadTs ?? sent.answer.ts)
      return {
        channelId: sent.answer.channel ?? input.channelId,
        ts: sent.answer.ts,
        ...Option.match(sent.charts, { onNone: () => ({}), onSome: (charts) => ({ charts }) }),
      }
    })

    const upload = Effect.fnUntraced(function* (
      connection: Connection,
      input: {
        readonly channelId: string
        readonly threadTs?: string | undefined
        readonly filename: string
        readonly bytes: Uint8Array
        readonly title?: string | undefined
      },
    ) {
      const target = yield* connection.client.post(
        "files.getUploadURLExternal",
        { filename: input.filename, length: input.bytes.length },
        UploadUrl,
        connection.token,
      )
      yield* connection.client.upload(target.upload_url, input.bytes)
      yield* connection.client.post(
        "files.completeUploadExternal",
        {
          files: [{ id: target.file_id, title: input.title ?? input.filename }],
          channel_id: input.channelId,
          ...(input.threadTs && { thread_ts: input.threadTs }),
        },
        Ok,
        connection.token,
      )
    })

    const ownerOf = (connection: Connection) => ({
      organizationId: connection.actor.organizationId,
      spaceId: connection.actor.agent.spaceId,
    })

    const replyToCurrentThread = Effect.fnUntraced(function* (
      connection: Connection,
      input: { readonly text: string; readonly charts?: ReadonlyArray<unknown> },
    ) {
      const latest = (yield* database.db
        .select()
        .from(thread)
        .where(and(eq(thread.session_id, connection.actor.agent.sessionId), isNotNull(thread.last_message_at)))
        .orderBy(desc(thread.last_message_at))
        .limit(1)
        .pipe(Effect.orDie)).at(0)
      if (latest?.provider !== "slack") return yield* new Refused({ message: "This session did not come from Slack." })
      yield* reachable(connection, latest.thread.slice(0, latest.thread.indexOf(":")))
      const provider = registry.get("slack")
      if (Option.isNone(provider)) return yield* new Refused({ message: "Slack is not set up on this Ren server." })
      const place = latest.place_name ?? latest.thread
      const charts = yield* provider.value
        .send(
          { install: latest.install, place, thread: latest.thread, message: latest.last_message ?? "" },
          input.text,
          input.charts,
        )
        .pipe(
          Effect.retry({
            while: (error) => error._tag === "ChannelProvider.Unavailable",
            times: 3,
            schedule: Schedule.exponential("1 second"),
          }),
          Effect.catchTags({
            "ChannelProvider.PlaceGone": () =>
              Effect.fail(new Refused({ message: "The Slack thread is gone, so the reply was not sent." })),
            "ChannelProvider.Unavailable": () =>
              Effect.fail(
                new Refused({ message: "Slack did not answer, so the reply was not sent. Try again later." }),
              ),
            "ChannelProvider.Rejected": (error) =>
              Effect.fail(new Refused({ message: `Slack refused the reply: ${error.message}` })),
          }),
        )
      const since = DateTime.fromDateUnsafe(latest.last_reply_at ?? latest.created_at)
      const outputs = yield* drives
        .files(ownerOf(connection), Drive.outputsOf(connection.actor.agent.sessionId))
        .pipe(Effect.orElseSucceed((): ReadonlyArray<Drive.File> => []))
      yield* Effect.forEach(
        outputs.filter((file) => DateTime.isGreaterThan(file.modifiedAt, since)),
        (file) =>
          drives.read(ownerOf(connection), file.path).pipe(
            Effect.flatMap((bytes) =>
              upload(connection, {
                channelId: latest.thread.slice(0, latest.thread.indexOf(":")),
                threadTs: latest.thread.slice(latest.thread.indexOf(":") + 1),
                filename: file.path.slice(file.path.lastIndexOf("/") + 1),
                bytes,
              }),
            ),
            Effect.catchCause((cause) => Effect.logWarning(`${file.path} could not be uploaded to Slack`, cause)),
          ),
        { discard: true },
      )
      yield* database.db
        .update(thread)
        .set({ last_reply_at: new Date() })
        .where(eq(thread.id, latest.id))
        .pipe(Effect.orDie)
      return {
        provider: "slack",
        place,
        ...Option.match(charts, { onNone: () => ({}), onSome: (report) => ({ charts: report }) }),
      } satisfies Channel.Sent
    })

    const renUserOf = (connection: Connection, slackUserId: string) =>
      database.db
        .select({ userId: accounts.userId })
        .from(accounts)
        .where(and(eq(accounts.providerId, "slack"), eq(accounts.accountId, `${connection.workspace}:${slackUserId}`)))
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows.at(0)?.userId ?? null),
        )

    const defined: ReadonlyArray<Defined> = [
      define(
        "reply_to_current_thread",
        {
          ...withCharts({ text: Text }),
          description:
            "Reply to the Slack thread that started this session. Ren posts it in the thread’s channel, then uploads to the thread every file you showed with show_file since your last reply. Fails if this session did not come from Slack.",
        },
        replyToCurrentThread,
      ),
      define(
        "post_new_message",
        {
          ...withCharts({ channelId: ChannelId, text: Text }),
          description:
            "Post a new message to a Slack channel as the bot. To reply inside an existing thread, use reply_in_thread instead. A reply in the new thread continues this session.",
        },
        post,
      ),
      define(
        "reply_in_thread",
        {
          ...withCharts({
            channelId: ChannelId,
            threadTs: Ts.annotate({ description: "Timestamp of the thread’s root message" }),
            text: Text,
          }),
          description:
            "Reply to an existing Slack thread as the bot. Needs the channelId and the thread’s root timestamp (threadTs). A reply in that thread continues this session.",
        },
        post,
      ),
      define(
        "upload_file",
        {
          input: Schema.Struct({
            channelId: ChannelId,
            threadTs: Schema.optionalKey(Ts),
            filename: Schema.optionalKey(
              Schema.NonEmptyString.annotate({
                description: "File name, e.g. report.md. With path, defaults to the file’s name in the drive.",
              }),
            ),
            content: Schema.optionalKey(Schema.String.annotate({ description: "The file’s text" })),
            path: Schema.optionalKey(
              Schema.NonEmptyString.annotate({
                description:
                  "A file in the space’s drive, such as the path show_file returned. Use it for an image, a PDF or any file that is not text.",
              }),
            ),
            title: Schema.optionalKey(Schema.String),
          }),
          description:
            "Upload a file to a Slack channel or thread as the bot: text you pass as content, or a file of the space’s drive by its path.",
        },
        Effect.fnUntraced(function* (connection, input) {
          yield* reachable(connection, input.channelId)
          const path = input.path
          if (!path && !("content" in input))
            return yield* new Refused({ message: "upload_file needs content or path." })
          const bytes = path
            ? yield* drives.read(ownerOf(connection), path).pipe(
                Effect.catchTags({
                  "Primitive.NotFound": () =>
                    Effect.fail(new Refused({ message: `The space’s drive has no file ${path}.` })),
                  "Drives.Unavailable": () =>
                    Effect.fail(new Refused({ message: `The space’s drive did not answer, so ${path} was not read.` })),
                }),
              )
            : new TextEncoder().encode(input.content)
          const filename = input.filename ?? path?.slice(path.lastIndexOf("/") + 1)
          if (!filename) return yield* new Refused({ message: "upload_file needs a filename with content." })
          yield* upload(connection, {
            channelId: input.channelId,
            threadTs: input.threadTs,
            filename,
            bytes,
            title: input.title,
          })
          return { ok: true }
        }),
      ),
      define(
        "react",
        {
          input: Schema.Struct({
            channelId: ChannelId,
            messageTs: Ts,
            emoji: Schema.NonEmptyString.annotate({ description: "Emoji name without colons, e.g. white_check_mark" }),
            remove: Schema.optionalKey(
              Schema.Boolean.annotate({ description: "Remove the reaction instead of adding it" }),
            ),
          }),
          description: "Add an emoji reaction to a Slack message as the bot, or remove it.",
        },
        Effect.fnUntraced(function* (connection, input) {
          yield* reachable(connection, input.channelId)
          yield* connection.client
            .post(
              input.remove ? "reactions.remove" : "reactions.add",
              { channel: input.channelId, timestamp: input.messageTs, name: input.emoji.replaceAll(":", "") },
              Ok,
              connection.token,
            )
            .pipe(
              Effect.catchTag("SlackApp.Failed", (error) =>
                error.error && ignoredReactions.has(error.error) ? Effect.void : Effect.fail(error),
              ),
            )
          return { ok: true }
        }),
      ),
      define(
        "edit_message",
        {
          input: Schema.Struct({ channelId: ChannelId, ts: Ts, text: Text }),
          description: "Edit a message the bot sent. Needs the channelId and the message timestamp (ts).",
        },
        Effect.fnUntraced(function* (connection, input) {
          yield* reachable(connection, input.channelId)
          const answer = yield* connection.client.post(
            "chat.update",
            { channel: input.channelId, ts: input.ts, ...Slack.message(input.text) },
            Posted,
            connection.token,
          )
          return { channelId: answer.channel ?? input.channelId, ts: answer.ts }
        }),
      ),
      define(
        "delete_message",
        {
          input: Schema.Struct({ channelId: ChannelId, ts: Ts }),
          description: "Delete a message the bot sent. Needs the channelId and the message timestamp (ts).",
        },
        Effect.fnUntraced(function* (connection, input) {
          yield* reachable(connection, input.channelId)
          yield* connection.client.post("chat.delete", { channel: input.channelId, ts: input.ts }, Ok, connection.token)
          return { ok: true }
        }),
      ),
      define(
        "list_channels",
        {
          input: Schema.Struct({}),
          description: "List the Slack channels the bot can see, with their IDs and names.",
        },
        Effect.fnUntraced(function* (connection) {
          const provider = registry.get("slack")
          if (Option.isNone(provider)) return yield* new Refused({ message: "Slack is not set up on this Ren server." })
          const places = yield* provider.value
            .places(connection.workspace)
            .pipe(Effect.mapError((error) => new Refused({ message: error.message })))
          return { channels: places.map((place) => ({ id: place.id, name: place.name, private: place.private })) }
        }),
      ),
      define(
        "read_thread",
        {
          input: Schema.Struct({ channelId: ChannelId, threadTs: Ts, limit: Limit, cursor: Cursor }),
          description:
            "Read the messages of a Slack thread. Needs the channelId and the thread’s root timestamp. Returns messages and a nextCursor for the next page.",
        },
        Effect.fnUntraced(function* (connection, input) {
          yield* reachable(connection, input.channelId)
          const answer = yield* connection.client.post(
            "conversations.replies",
            {
              channel: input.channelId,
              ts: input.threadTs,
              limit: input.limit ?? 50,
              ...(input.cursor && { cursor: input.cursor }),
            },
            Messages,
            connection.token,
          )
          return { messages: messagesOf(answer), nextCursor: answer.response_metadata?.next_cursor || null }
        }),
      ),
      define(
        "read_channel_history",
        {
          input: Schema.Struct({
            channelId: ChannelId,
            limit: Limit,
            oldest: Schema.optionalKey(Ts.annotate({ description: "Only messages after this timestamp" })),
            cursor: Cursor,
          }),
          description: "Read recent messages in a Slack channel. Returns messages and a nextCursor for the next page.",
        },
        Effect.fnUntraced(function* (connection, input) {
          yield* reachable(connection, input.channelId)
          const answer = yield* connection.client.post(
            "conversations.history",
            {
              channel: input.channelId,
              limit: input.limit ?? 50,
              ...(input.oldest && { oldest: input.oldest }),
              ...(input.cursor && { cursor: input.cursor }),
            },
            Messages,
            connection.token,
          )
          return { messages: messagesOf(answer), nextCursor: answer.response_metadata?.next_cursor || null }
        }),
      ),
      define(
        "get_reactions",
        {
          input: Schema.Struct({ channelId: ChannelId, messageTs: Ts }),
          description: "Get the emoji reactions on a Slack message: names, counts and the reacting users.",
        },
        Effect.fnUntraced(function* (connection, input) {
          yield* reachable(connection, input.channelId)
          const answer = yield* connection.client.post(
            "reactions.get",
            { channel: input.channelId, timestamp: input.messageTs },
            Reactions,
            connection.token,
          )
          return {
            reactions: (answer.message?.reactions ?? []).map((reaction) => ({
              name: reaction.name,
              count: reaction.count,
              users: reaction.users ?? [],
            })),
          }
        }),
      ),
      define(
        "lookup_user",
        {
          input: Schema.Struct({
            slackUserId: Schema.optionalKey(Schema.NonEmptyString),
            email: Schema.optionalKey(Schema.NonEmptyString),
          }),
          description: "Look up a Slack user by slackUserId or by email: their name, email and Ren user, if linked.",
        },
        Effect.fnUntraced(function* (connection, input) {
          if (!input.email && !input.slackUserId)
            return yield* new Refused({ message: "Give a slackUserId or an email." })
          const answer = input.email
            ? yield* connection.client.post("users.lookupByEmail", { email: input.email }, UserInfo, connection.token)
            : yield* connection.client.post("users.info", { user: input.slackUserId ?? "" }, UserInfo, connection.token)
          return { ...userOf(answer.user), renUserId: yield* renUserOf(connection, answer.user.id) }
        }),
      ),
      define(
        "list_users",
        {
          input: Schema.Struct({ includeBots: Schema.optionalKey(Schema.Boolean), limit: Limit, cursor: Cursor }),
          description: "List the users of the Slack workspace with their IDs, names, emails and admin status.",
        },
        Effect.fnUntraced(function* (connection, input) {
          const answer = yield* connection.client.post(
            "users.list",
            { limit: input.limit ?? 100, ...(input.cursor && { cursor: input.cursor }) },
            Members,
            connection.token,
          )
          return {
            users: answer.members
              .filter((member) => !member.deleted && (input.includeBots || !member.is_bot))
              .map((member) => ({
                slackUserId: member.id,
                name: member.real_name ?? member.name ?? null,
                email: member.profile?.email ?? null,
                isAdmin: member.is_admin ?? false,
                isBot: member.is_bot ?? false,
              })),
            nextCursor: answer.response_metadata?.next_cursor || null,
          }
        }),
      ),
    ]

    return Service.of({
      tools: defined.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input: tool.input,
        posts: tool.posts,
      })),
      enabled,
      call: Effect.fn("SlackBot.call")(function* (actor: Actor.AgentInfo, name: string, args: unknown) {
        const tool = defined.find((each) => each.name === name)
        if (!tool) return yield* new Refused({ message: `Slack has no tool ${name}.` })
        const connection = yield* connect(actor)
        return yield* tool
          .run(connection, args)
          .pipe(Effect.catchTag("SlackApp.Failed", (error) => Effect.fail(new Refused({ message: error.message }))))
      }),
    })
  }),
)
