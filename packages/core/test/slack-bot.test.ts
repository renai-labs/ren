import { afterAll, describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import { Channel } from "@ren/schema/channel"
import { ChannelInstall } from "@ren/schema/channel-install"
import { ChannelMapping } from "@ren/schema/channel-mapping"
import { Space } from "@ren/schema/space"
import type { Session } from "@ren/schema/session"
import { and, eq } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import type { Actor } from "../src/actor.js"
import { ChannelProvider } from "../src/channel-provider.js"
import { Slack } from "../src/channel-provider/slack.js"
import { ChannelSecrets } from "../src/channel-secrets.js"
import { Envelope } from "../src/envelope.js"
import { SlackApp } from "../src/slack-app.js"
import { SlackBot } from "../src/slack-bot.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { SlackServer } from "./lib/slack-server.js"

const slack = SlackServer.start()
afterAll(() => slack.stop())

const it = testEffect(
  SlackBot.layer.pipe(
    Layer.provideMerge(ChannelProvider.layer(Effect.all([Slack.provider]))),
    Layer.provideMerge(SlackApp.layer),
    Layer.provideMerge(ChannelSecrets.layer),
    Layer.provideMerge(Envelope.layerLocal),
    Layer.provideMerge(Testing.layer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          ...SlackServer.config(slack.url),
          ENVELOPE_KEYS: JSON.stringify([
            { id: "local:test", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
          ]),
        }),
      ),
    ),
  ),
)

const installed = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID) {
  const database = yield* Database.Service
  const secrets = yield* ChannelSecrets.Service
  const workspace = `T${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  const token = `xoxb-${crypto.randomUUID()}`
  slack.grants.set(`grant-${workspace}`, { team: workspace, teamName: "Acme", user: "U01", token })
  const id = ChannelInstall.ID.create()
  yield* database.db.insert(Database.Schema.channel_install).values({
    id,
    organization_id: organizationId,
    provider: "slack",
    workspace,
    name: "Acme",
    bot_user: "UBOT",
    secret: yield* secrets.seal(organizationId, id, Redacted.make(token)),
  })
  return { id, workspace, token }
})

const mapped = Effect.fnUntraced(function* (
  owner: Effect.Success<ReturnType<typeof Seed.owner>>,
  installId: ChannelInstall.ID,
  spaceId: Space.ID,
) {
  const database = yield* Database.Service
  yield* database.db.insert(Database.Schema.channel_mapping).values({
    id: ChannelMapping.ID.create(),
    install_id: installId,
    place: "C07",
    place_name: "eng",
    space_id: spaceId,
    fallback: true,
    created_by: owner.createdBy,
  })
})

const asAgent = (
  owner: Effect.Success<ReturnType<typeof Seed.owner>>,
  sessionId: Session.ID,
  spaceId = owner.spaceId,
): Actor.AgentInfo => ({
  userId: owner.createdBy,
  organizationId: owner.organizationId,
  roles: ["owner"],
  agent: { agentId: Agent.ID.create(), sessionId, spaceId, fence: null },
})

const ownSpace = Effect.fnUntraced(function* (owner: Effect.Success<ReturnType<typeof Seed.owner>>) {
  const database = yield* Database.Service
  const id = Space.ID.create()
  yield* database.db.insert(Database.Schema.space).values({
    id,
    organization_id: owner.organizationId,
    kind: "private",
    owner_user_id: owner.createdBy,
    slug: "personal-space",
    name: "Personal Space",
  })
  yield* Seed.join(id, owner.createdBy)
  return id
})

describe("SlackBot", () => {
  it.live(
    "the Slack tools are on in a space with a mapped Slack channel, the install's default space or a private space, and refused elsewhere",
    () =>
      Effect.gen(function* () {
        const bot = yield* SlackBot.Service
        const owner = yield* Seed.owner()
        const own = yield* ownSpace(owner)
        expect(yield* bot.enabled(owner.organizationId, own)).toBe(false)
        const install = yield* installed(owner.organizationId)
        const mappedSpace = yield* Seed.space(owner.organizationId)
        const other = yield* Seed.space(owner.organizationId)
        yield* mapped(owner, install.id, mappedSpace)
        expect(
          yield* Effect.forEach([owner.spaceId, mappedSpace, own, other], (spaceId) =>
            bot.enabled(owner.organizationId, spaceId),
          ),
        ).toEqual([true, true, true, false])
        const sessionId = yield* Seed.session({ ...owner, spaceId: other })
        expect(yield* Effect.flip(bot.call(asAgent(owner, sessionId, other), "list_channels", {}))).toMatchObject({
          _tag: "SlackBot.Refused",
          message: "Slack is not connected to this space. Map a Slack channel to it in Settings → Channels.",
        })
      }),
  )

  it.live("the session's Slack thread is answered with slack_reply_to_current_thread", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const bot = yield* SlackBot.Service
      const owner = yield* Seed.owner()
      const install = yield* installed(owner.organizationId)
      const sessionId = yield* Seed.session(owner)
      yield* database.db.insert(Database.Schema.channel_thread).values({
        id: Channel.ThreadID.create(),
        organization_id: owner.organizationId,
        provider: "slack",
        install: install.workspace,
        thread: "C07:1712.33",
        session_id: sessionId,
        place_name: "eng",
        last_message: "1712.40",
        last_message_at: new Date(),
      })
      expect(yield* bot.call(asAgent(owner, sessionId), "reply_to_current_thread", { text: "Done." })).toEqual({
        provider: "slack",
        place: "eng",
      })
      expect(slack.posted.at(-1)).toEqual({
        method: "chat.postMessage",
        token: install.token,
        params: {
          channel: "C07",
          thread_ts: "1712.33",
          text: "Done.",
          blocks: JSON.stringify([{ type: "markdown", text: "Done." }]),
        },
      })
      expect(
        (yield* Effect.flip(
          bot.call(asAgent(owner, yield* Seed.session(owner)), "reply_to_current_thread", { text: "Done." }),
        )).message,
      ).toBe("This session did not come from Slack.")
    }),
  )

  it.live(
    "a post binds its thread to the session; Slack DMs work only in a private space, never a shared one, even with one member",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const bot = yield* SlackBot.Service
        const owner = yield* Seed.owner()
        const install = yield* installed(owner.organizationId)
        const sessionId = yield* Seed.session(owner)
        const posted = yield* bot.call(asAgent(owner, sessionId), "post_new_message", {
          channelId: "C09",
          text: "The deploy is done.",
        })
        expect(posted).toMatchObject({ channelId: "C09" })
        const ts = slack.posted.length
        expect(
          yield* database.db
            .select({ sessionId: Database.Schema.channel_thread.session_id })
            .from(Database.Schema.channel_thread)
            .where(
              and(
                eq(Database.Schema.channel_thread.install, install.workspace),
                eq(Database.Schema.channel_thread.thread, `C09:${ts}.0`),
              ),
            ),
        ).toEqual([{ sessionId }])
        const dmThread = (session: Session.ID) =>
          database.db.insert(Database.Schema.channel_thread).values({
            id: Channel.ThreadID.create(),
            organization_id: owner.organizationId,
            provider: "slack",
            install: install.workspace,
            thread: "D01:1712.33",
            session_id: session,
            last_message: "1712.33",
            last_message_at: new Date(),
          })
        const refusal = "This is a shared space; Ren can’t use Slack DMs from here. Use the space’s mapped channels."
        expect(
          (yield* Effect.flip(
            bot.call(asAgent(owner, sessionId), "post_new_message", { channelId: "D01", text: "Psst" }),
          )).message,
        ).toBe(refusal)
        const shared = yield* Seed.session(owner)
        yield* dmThread(shared)
        expect(
          (yield* Effect.flip(bot.call(asAgent(owner, shared), "reply_to_current_thread", { text: "Psst" }))).message,
        ).toBe(refusal)
        yield* database.db
          .delete(Database.Schema.channel_thread)
          .where(eq(Database.Schema.channel_thread.session_id, shared))
        const own = yield* ownSpace(owner)
        const mine = yield* Seed.session({ ...owner, spaceId: own })
        yield* dmThread(mine)
        yield* bot.call(asAgent(owner, mine, own), "post_new_message", { channelId: "D01", text: "Psst" })
        yield* bot.call(asAgent(owner, mine, own), "reply_to_current_thread", { text: "On it." })
        expect(slack.posted.at(-1)?.params).toMatchObject({ channel: "D01", thread_ts: "1712.33", text: "On it." })
      }),
  )

  it.live("a read returns Slack's messages, and a Slack error comes back with Slack's code", () =>
    Effect.gen(function* () {
      const bot = yield* SlackBot.Service
      const owner = yield* Seed.owner()
      yield* installed(owner.organizationId)
      const sessionId = yield* Seed.session(owner)
      slack.channels.splice(0, slack.channels.length, { id: "C07", name: "eng", is_private: false })
      expect(yield* bot.call(asAgent(owner, sessionId), "list_channels", {})).toEqual({
        channels: [{ id: "C07", name: "eng", private: false }],
      })
      slack.replies.splice(
        0,
        slack.replies.length,
        ...["1.0", "2.0", "3.0"].map((ts) => ({ ts, user: "U01", text: `message ${ts}` })),
      )
      const first = yield* bot.call(asAgent(owner, sessionId), "read_thread", {
        channelId: "C07",
        threadTs: "1.0",
        limit: 2,
      })
      expect(first).toEqual({
        messages: [
          { ts: "1.0", userId: "U01", text: "message 1.0" },
          { ts: "2.0", userId: "U01", text: "message 2.0" },
        ],
        nextCursor: "2",
      })
      expect(
        yield* bot.call(asAgent(owner, sessionId), "read_thread", {
          channelId: "C07",
          threadTs: "1.0",
          limit: 2,
          cursor: "2",
        }),
      ).toEqual({ messages: [{ ts: "3.0", userId: "U01", text: "message 3.0" }], nextCursor: null })
      slack.options.postError = "not_in_channel"
      const refused = yield* Effect.flip(
        bot.call(asAgent(owner, sessionId), "post_new_message", { channelId: "C08", text: "hi" }),
      )
      slack.options.postError = undefined
      expect(refused.message).toBe("Slack refused chat.postMessage: not_in_channel")
      expect(
        (yield* Effect.flip(bot.call(asAgent(owner, sessionId), "post_new_message", { channelId: "C08" }))).message,
      ).toContain("text")
    }),
  )
})
