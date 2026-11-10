import { afterAll, describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import { Channel } from "@ren/schema/channel"
import { IntakeThread } from "@ren/schema/intake-thread"
import { ChannelInstall } from "@ren/schema/channel-install"
import { ChannelMapping } from "@ren/schema/channel-mapping"
import { Space } from "@ren/schema/space"
import type { Session } from "@ren/schema/session"
import { and, eq, sql } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import type { Actor } from "../src/actor.js"
import { Access } from "../src/access.js"
import { ChannelProvider } from "../src/channel-provider.js"
import { Slack } from "../src/channel-provider/slack.js"
import { ChannelSecrets } from "../src/channel-secrets.js"
import { Drives } from "../src/drives.js"
import { Envelope } from "../src/envelope.js"
import { SlackApp } from "../src/slack-app.js"
import { SlackBot } from "../src/slack-bot.js"
import { TestDrives } from "./lib/drives.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { SlackServer } from "./lib/slack-server.js"

const slack = SlackServer.start()
afterAll(() => slack.stop())

const it = testEffect(
  SlackBot.layer.pipe(
    Layer.provideMerge(Drives.layer.pipe(Layer.provide(Access.layer), Layer.provide(TestDrives.layer))),
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

const slackThread = Effect.fnUntraced(function* (
  owner: Effect.Success<ReturnType<typeof Seed.owner>>,
  workspace: string,
  sessionId: Session.ID,
  options: { readonly thread?: string; readonly data?: Channel.ThreadData; readonly createdAt?: Date } = {},
) {
  const database = yield* Database.Service
  yield* database.db.insert(Database.Schema.intake_thread).values({
    id: IntakeThread.ID.create(),
    organization_id: owner.organizationId,
    origin: "slack",
    origin_id: workspace,
    thread_key: options.thread ?? "C07:1712.33",
    current_session_id: sessionId,
    channel_state: {
      placeName: "eng",
      lastMessage: "1712.40",
      lastMessageAt: new Date().toISOString(),
      ...(options.data?.slack && { slack: options.data.slack }),
    },
    ...(options.createdAt && { created_at: options.createdAt }),
  })
})

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))

const lastCall = (method: string) => slack.posted.findLast((post) => post.method === method)?.params

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
        expect(yield* Effect.flip(bot.call(asAgent(owner, sessionId, other), "list_user_channels", {}))).toMatchObject({
          _tag: "SlackBot.Refused",
          message: "Slack is not connected to this space. Map a Slack channel to it in Settings → Mentions.",
        })
      }),
  )

  it.live(
    "send_message without a channel_id answers the session's Slack thread, and so does one with that thread's own ids; read_thread without ids reads it",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const bot = yield* SlackBot.Service
        const owner = yield* Seed.owner()
        const install = yield* installed(owner.organizationId)
        const sessionId = yield* Seed.session(owner)
        yield* slackThread(owner, install.workspace, sessionId)
        slack.threads.set("C07:1712.33", [])
        const answer = { provider: "slack", place: "eng", channel_id: "C07", thread_ts: "1712.33" }
        expect(yield* bot.call(asAgent(owner, sessionId), "send_message", { message: "Done." })).toEqual(answer)
        expect(slack.posted.at(-1)).toEqual({
          method: "chat.postMessage",
          token: install.token,
          params: {
            channel: "C07",
            thread_ts: "1712.33",
            unfurl_links: "false",
            text: "Done.",
            blocks: JSON.stringify([{ type: "markdown", text: "Done." }]),
          },
        })
        const pie = { type: "pie", title: "Models", segments: [{ label: "Opus", value: 3 }] }
        expect(
          yield* bot.call(asAgent(owner, sessionId), "send_message", {
            message: "Here are the models.",
            charts: [pie, { title: "Broken", type: "pie" }],
          }),
        ).toEqual({
          ...answer,
          charts: {
            sent: 1,
            repaired: [],
            dropped: [{ title: "Broken", reason: expect.stringContaining("It is not a valid chart:") }],
          },
        })
        expect(slack.posted.at(-1)?.params.blocks).toContain('"type":"data_visualization"')
        yield* database.db
          .update(Database.Schema.intake_thread)
          .set({ channel_state: sql`${Database.Schema.intake_thread.channel_state} - 'lastReplyAt'` })
          .where(eq(Database.Schema.intake_thread.current_session_id, sessionId))
        expect(
          yield* bot.call(asAgent(owner, sessionId), "send_message", {
            channel_id: "C07",
            thread_ts: "1712.33",
            message: "Also this.",
          }),
        ).toEqual(answer)
        expect(
          yield* database.db
            .select({ repliedAt: sql<string | null>`${Database.Schema.intake_thread.channel_state} ->> 'lastReplyAt'` })
            .from(Database.Schema.intake_thread)
            .where(eq(Database.Schema.intake_thread.current_session_id, sessionId)),
        ).toEqual([{ repliedAt: expect.any(String) }])
        expect(yield* bot.call(asAgent(owner, sessionId), "read_thread", {})).toMatchObject({
          messages: [{ text: "Done." }, { text: "Here are the models." }, { text: "Also this." }],
        })
        expect(
          yield* bot.call(asAgent(owner, sessionId), "send_message", {
            channel_id: "C09",
            message: "Hi",
            charts: [pie],
          }),
        ).toMatchObject({ channel_id: "C09", charts: { sent: 1 } })
        expect(
          (yield* Effect.flip(
            bot.call(asAgent(owner, yield* Seed.session(owner)), "send_message", { message: "Done." }),
          )).message,
        ).toBe("This chat did not start in a Slack thread, so there is nothing to answer: give a channel_id.")
      }),
  )

  it.live(
    "an answer posts the files the agent showed since its last answer and the files it names, each once, as ren-v1 did; a message elsewhere posts its files in its thread",
    () =>
      Effect.gen(function* () {
        const bot = yield* SlackBot.Service
        const drives = yield* Drives.Service
        const owner = yield* Seed.owner()
        const install = yield* installed(owner.organizationId)
        const sessionId = yield* Seed.session(owner)
        yield* slackThread(owner, install.workspace, sessionId, { createdAt: new Date(Date.now() - 60_000) })
        const chart = `chats/${sessionId}/outputs/chart.png`
        yield* drives.put(owner, chart, new TextEncoder().encode("png bytes"), "image/png")
        const uploads = slack.uploads.size
        const completed = () => slack.posted.filter((post) => post.method === "files.completeUploadExternal")
        yield* bot.call(asAgent(owner, sessionId), "send_message", {
          message: "Here is the chart.",
          files: [chart, { name: "notes.md", content: "# Notes" }],
        })
        expect([...slack.uploads.values()].slice(uploads)).toEqual(["png bytes", "# Notes"])
        expect(completed().at(-1)?.params).toMatchObject({ channel_id: "C07", thread_ts: "1712.33" })
        expect(completed().at(-1)?.params.files).toContain('"title":"notes.md"')
        yield* bot.call(asAgent(owner, sessionId), "send_message", { message: "Anything else?" })
        expect(slack.uploads.size).toBe(uploads + 2)

        const sent = yield* bot.call(asAgent(owner, sessionId), "send_message", {
          channel_id: "C09",
          message: "The chart.",
          files: [chart],
        })
        expect([...slack.uploads.values()].at(-1)).toBe("png bytes")
        expect(completed().at(-1)?.params).toMatchObject({
          channel_id: "C09",
          thread_ts: `${slack.posted.findLastIndex((post) => post.method === "chat.postMessage") + 1}.0`,
        })
        expect(sent).toMatchObject({ channel_id: "C09" })
        const posts = slack.posted.length
        expect(
          (yield* Effect.flip(
            bot.call(asAgent(owner, sessionId), "send_message", {
              channel_id: "C09",
              message: "Missing.",
              files: ["chats/gone.png"],
            }),
          )).message,
        ).toBe("The space’s drive has no file chats/gone.png.")
        expect(slack.posted.length).toBe(posts)
      }),
  )

  it.live(
    "a post binds its thread to the session; Slack DMs and group DMs work only in a private space, never a shared one, even with one member",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const bot = yield* SlackBot.Service
        const owner = yield* Seed.owner()
        const install = yield* installed(owner.organizationId)
        const sessionId = yield* Seed.session(owner)
        const posted = yield* bot.call(asAgent(owner, sessionId), "send_message", {
          channel_id: "C09",
          message: "The deploy is done.",
        })
        const ts = `${slack.posted.findLastIndex((post) => post.method === "chat.postMessage") + 1}.0`
        expect(posted).toEqual({
          channel_id: "C09",
          message_ts: ts,
          message_link: `${slack.url}/archives/C09/p${ts.replace(".", "")}`,
        })
        expect(
          yield* database.db
            .select({ sessionId: Database.Schema.intake_thread.current_session_id })
            .from(Database.Schema.intake_thread)
            .where(
              and(
                eq(Database.Schema.intake_thread.origin_id, install.workspace),
                eq(Database.Schema.intake_thread.thread_key, `C09:${ts}`),
              ),
            ),
        ).toEqual([{ sessionId }])
        yield* bot.call(asAgent(owner, sessionId), "send_message", {
          channel_id: "C09",
          message: "Everyone, look.",
          thread_ts: "1712.33",
          reply_broadcast: true,
        })
        expect(lastCall("chat.postMessage")).toMatchObject({ thread_ts: "1712.33", reply_broadcast: "true" })
        const refusal =
          "This is a shared space; Ren can’t use Slack DMs or group DMs from here. Use the space’s mapped channels."
        slack.channels.splice(0, slack.channels.length, {
          id: "G01",
          name: "mpdm-ana--bo",
          is_private: true,
          is_mpim: true,
        })
        expect(
          yield* Effect.forEach(["D01", "U02", "G01"], (channel) =>
            Effect.flip(bot.call(asAgent(owner, sessionId), "send_message", { channel_id: channel, message: "Psst" })),
          ),
        ).toMatchObject([{ message: refusal }, { message: refusal }, { message: refusal }])
        const shared = yield* Seed.session(owner)
        yield* slackThread(owner, install.workspace, shared, { thread: "D01:1712.33" })
        expect(
          (yield* Effect.flip(bot.call(asAgent(owner, shared), "send_message", { message: "Psst" }))).message,
        ).toBe(refusal)
        const own = yield* ownSpace(owner)
        const mine = yield* Seed.session({ ...owner, spaceId: own })
        yield* slackThread(owner, install.workspace, mine, { thread: "D01:1712.34" })
        yield* bot.call(asAgent(owner, mine, own), "send_message", { channel_id: "U02", message: "Psst" })
        expect(lastCall("chat.postMessage")).toMatchObject({ channel: "DU02", text: "Psst" })
        yield* bot.call(asAgent(owner, mine, own), "send_message", { message: "On it." })
        expect(slack.posted.at(-1)?.params).toMatchObject({ channel: "D01", thread_ts: "1712.34", text: "On it." })
      }),
  )

  it.live(
    "a read names the people and channels it mentions and shows threads and file ids; a Slack error comes back with Slack's code, and a missing permission asks for a reinstall",
    () =>
      Effect.gen(function* () {
        const bot = yield* SlackBot.Service
        const owner = yield* Seed.owner()
        yield* installed(owner.organizationId)
        const sessionId = yield* Seed.session(owner)
        slack.users.set("U01", { name: "ana", real_name: "Ana Lima" })
        slack.channels.splice(0, slack.channels.length, { id: "C07", name: "eng", is_private: false })
        slack.replies.splice(
          0,
          slack.replies.length,
          { ts: "1.0", user: "U01", text: "ask <@U01> in <#C07>" },
          {
            ts: "2.0",
            user: "U01",
            text: "the demo",
            files: [{ id: "F01", name: "demo.mp4", mimetype: "video/mp4" }],
          },
          { ts: "3.0", user: "U02", text: "a thread", thread_ts: "3.0", reply_count: 2 },
        )
        const first = yield* bot.call(asAgent(owner, sessionId), "read_thread", {
          channel_id: "C07",
          message_ts: "1.0",
          limit: 2,
        })
        expect(first).toEqual({
          messages: [
            {
              ts: "1.0",
              user_id: "U01",
              user_name: "Ana Lima",
              text: "ask @Ana Lima in #eng",
              is_bot: false,
              thread_ts: null,
              reply_count: 0,
              files: [],
            },
            {
              ts: "2.0",
              user_id: "U01",
              user_name: "Ana Lima",
              text: "the demo",
              is_bot: false,
              thread_ts: null,
              reply_count: 0,
              files: [{ file_id: "F01", name: "demo.mp4", mimetype: "video/mp4" }],
            },
          ],
          next_cursor: "2",
        })
        expect(
          yield* bot.call(asAgent(owner, sessionId), "read_channel", { channel_id: "C07", latest: "4.0", cursor: "2" }),
        ).toEqual({
          messages: [
            {
              ts: "3.0",
              user_id: "U02",
              user_name: null,
              text: "a thread",
              is_bot: false,
              thread_ts: "3.0",
              reply_count: 2,
              files: [],
            },
          ],
          next_cursor: null,
        })
        slack.options.postError = "not_in_channel"
        const refused = yield* Effect.flip(
          bot.call(asAgent(owner, sessionId), "send_message", { channel_id: "C08", message: "hi" }),
        )
        slack.options.postError = "missing_scope"
        const unscoped = yield* Effect.flip(
          bot.call(asAgent(owner, sessionId), "add_reaction", { channel_id: "C08", message_ts: "1.0", emoji: "eyes" }),
        )
        slack.options.postError = undefined
        expect(refused.message).toBe("Slack refused chat.postMessage: not_in_channel")
        expect(unscoped.message).toContain("install Ren in Slack again")
        expect(
          (yield* Effect.flip(bot.call(asAgent(owner, sessionId), "send_message", { channel_id: "C08" }))).message,
        ).toContain("message")
      }),
  )

  it.live(
    "search_public searches as the sender of the session's latest Slack message with its action token, and says so when there is none or it ran out",
    () =>
      Effect.gen(function* () {
        const bot = yield* SlackBot.Service
        const owner = yield* Seed.owner()
        const install = yield* installed(owner.organizationId)
        const sessionId = yield* Seed.session(owner)
        expect(
          (yield* Effect.flip(bot.call(asAgent(owner, sessionId), "search_public", { query: "deploy" }))).message,
        ).toContain("works only in a chat that a Slack mention or DM started")
        yield* slackThread(owner, install.workspace, sessionId, {
          data: { slack: { actionToken: "12345.98765.abcd" } },
        })
        const hit = {
          author_name: "Ana Lima",
          author_user_id: "U01",
          channel_id: "C07",
          channel_name: "eng",
          message_ts: "1712.40",
          content: "The deploy failed",
          permalink: "https://acme.slack.com/archives/C07/p171240",
          is_author_bot: false,
        }
        slack.answers.set("assistant.search.context", (params) =>
          params.action_token === "12345.98765.abcd"
            ? { results: { messages: [hit] }, response_metadata: { next_cursor: "" } }
            : { error: "invalid_action_token" },
        )
        expect(
          yield* bot.call(asAgent(owner, sessionId), "search_public", { query: "deploy in:#eng", after: "1712000000" }),
        ).toEqual({ messages: [hit], files: [], next_cursor: null })
        expect(lastCall("assistant.search.context")).toMatchObject({
          query: "deploy in:#eng",
          channel_types: "public_channel",
          content_types: "messages",
          after: "1712000000",
        })
        slack.answers.set("assistant.search.context", () => ({ error: "invalid_action_token" }))
        expect(
          (yield* Effect.flip(bot.call(asAgent(owner, sessionId), "search_public", { query: "deploy" }))).message,
        ).toContain("ran out")
        slack.answers.delete("assistant.search.context")
      }),
  )

  it.live(
    "read_file returns a text file or a canvas as fenced text, and puts any other file in the space's drive",
    () =>
      Effect.gen(function* () {
        const bot = yield* SlackBot.Service
        const drives = yield* Drives.Service
        const owner = yield* Seed.owner()
        yield* installed(owner.organizationId)
        const sessionId = yield* Seed.session(owner)
        const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
        slack.files.set("F10", "line one\nline two")
        slack.files.set("F11", photo)
        const files: Record<string, object> = {
          F10: { id: "F10", name: "notes.txt", mimetype: "text/plain", url_private_download: `${slack.url}/files/F10` },
          F11: { id: "F11", name: "photo.jpg", mimetype: "image/jpeg", url_private_download: `${slack.url}/files/F11` },
          F12: { id: "F12", title: "Plan", filetype: "canvas" },
        }
        slack.answers.set("files.info", (params) => ({ file: files[params.file ?? ""] }))
        slack.answers.set("canvases.getContent", () => ({ content: "# Plan\n- ship" }))
        const read = (fileId: string) => bot.call(asAgent(owner, sessionId), "read_file", { file_id: fileId })
        expect(yield* read("F10")).toEqual({
          file_id: "F10",
          name: "notes.txt",
          mimetype: "text/plain",
          content: expect.stringMatching(/^<(file_content_\w+)>\nline one\nline two\n<\/\1>$/u),
        })
        expect(yield* read("F11")).toEqual({
          file_id: "F11",
          name: "photo.jpg",
          mimetype: "image/jpeg",
          size: 4,
          path: `chats/${sessionId}/uploads/slack-F11/photo.jpg`,
        })
        expect(yield* drives.read(owner, `chats/${sessionId}/uploads/slack-F11/photo.jpg`)).toEqual(photo)
        expect(yield* read("F12")).toMatchObject({ name: "Plan", content: expect.stringContaining("# Plan\n- ship") })
        slack.answers.delete("files.info")
        slack.answers.delete("canvases.getContent")
      }),
  )

  it.live(
    "a canvas is shared with the session's channel; update_canvas maps append and prepend around a section, and replace without one rewrites the canvas; read_canvas gives the section of each heading",
    () =>
      Effect.gen(function* () {
        const bot = yield* SlackBot.Service
        const owner = yield* Seed.owner()
        const install = yield* installed(owner.organizationId)
        const sessionId = yield* Seed.session(owner)
        yield* slackThread(owner, install.workspace, sessionId)
        slack.answers.set("canvases.create", () => ({ canvas_id: "F20" }))
        slack.answers.set("files.info", () => ({
          file: { id: "F20", permalink: "https://acme.slack.com/docs/T1/F20" },
        }))
        slack.answers.set("canvases.getContent", () => ({ content: "# Plan\nsteps\n## Risks\nnone" }))
        slack.answers.set("canvases.sections.lookup", (params) => ({
          sections: [{ id: params.criteria?.includes("Risks") ? "temp:C:2" : "temp:C:1" }],
        }))
        const call = (name: string, args: object) => bot.call(asAgent(owner, sessionId), name, args)
        expect(yield* call("create_canvas", { title: "Plan", content: "# Steps" })).toEqual({
          canvas_id: "F20",
          canvas_url: "https://acme.slack.com/docs/T1/F20",
          shared_with: "C07",
        })
        expect(lastCall("canvases.create")).toMatchObject({
          title: "Plan",
          document_content: JSON.stringify({ type: "markdown", markdown: "# Steps" }),
        })
        expect(lastCall("canvases.access.set")).toMatchObject({
          canvas_id: "F20",
          access_level: "write",
          channel_ids: JSON.stringify(["C07"]),
        })
        const changes = Effect.fnUntraced(function* (args: object) {
          yield* call("update_canvas", { canvas_id: "F20", content: "more", ...args })
          return decodeJson(lastCall("canvases.edit")?.changes ?? "[]")
        })
        expect(yield* changes({ action: "append", section_id: "temp:C:1" })).toMatchObject([
          { operation: "insert_after", section_id: "temp:C:1" },
        ])
        expect(yield* changes({ action: "prepend", section_id: "temp:C:1" })).toMatchObject([
          { operation: "insert_before", section_id: "temp:C:1" },
        ])
        expect(yield* changes({ action: "replace" })).toEqual([
          { operation: "replace", document_content: { type: "markdown", markdown: "more" } },
        ])
        expect(yield* call("read_canvas", { canvas_id: "F20" })).toEqual({
          canvas_id: "F20",
          content: "# Plan\nsteps\n## Risks\nnone",
          section_id_mapping: { "temp:C:1": "# Plan", "temp:C:2": "## Risks" },
        })
        slack.answers.delete("canvases.create")
        slack.answers.delete("files.info")
        slack.answers.delete("canvases.getContent")
        slack.answers.delete("canvases.sections.lookup")
      }),
  )

  it.live("search_users and search_channels match every word and leave out words with a minus", () =>
    Effect.gen(function* () {
      const bot = yield* SlackBot.Service
      const owner = yield* Seed.owner()
      yield* installed(owner.organizationId)
      const sessionId = yield* Seed.session(owner)
      slack.answers.set("users.list", () => ({
        members: [
          { id: "U01", name: "ana", real_name: "Ana Lima", profile: { title: "Engineering lead" } },
          { id: "U02", name: "bo", real_name: "Bo Chen", profile: { title: "Engineering intern" } },
          { id: "U03", name: "cy", real_name: "Cy Diaz", deleted: true, profile: { title: "Engineering" } },
        ],
      }))
      slack.channels.splice(
        0,
        slack.channels.length,
        { id: "C01", name: "eng-deploys", is_private: false },
        { id: "C02", name: "sales", is_private: false },
      )
      expect(
        yield* bot.call(asAgent(owner, sessionId), "search_users", { query: "engineering -intern" }),
      ).toMatchObject({
        users: [{ user_id: "U01", real_name: "Ana Lima", title: "Engineering lead" }],
        next_cursor: null,
      })
      expect(yield* bot.call(asAgent(owner, sessionId), "search_channels", { query: "deploys" })).toMatchObject({
        channels: [{ channel_id: "C01", name: "eng-deploys" }],
      })
      slack.answers.delete("users.list")
    }),
  )
})
