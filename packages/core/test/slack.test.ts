import { afterAll, describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import type { Channel } from "@ren/schema/channel"
import { ChannelInstall } from "@ren/schema/channel-install"
import { Session } from "@ren/schema/session"
import { ConfigProvider, Effect, Layer, Option, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import { ChannelProvider } from "../src/channel-provider.js"
import { Slack } from "../src/channel-provider/slack.js"
import { ChannelSecrets } from "../src/channel-secrets.js"
import { Envelope } from "../src/envelope.js"
import { SlackApp } from "../src/slack-app.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { SlackServer } from "./lib/slack-server.js"

const slack = SlackServer.start()
afterAll(() => slack.stop())

const it = testEffect(
  ChannelProvider.layer(Effect.all([Slack.provider])).pipe(
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

const provider = Effect.flatMap(ChannelProvider.Registry, (registry) =>
  Option.match(registry.get("slack"), {
    onNone: () => Effect.die(new Error("Slack is not set up")),
    onSome: Effect.succeed,
  }),
)

const installed = Effect.fnUntraced(function* () {
  const database = yield* Database.Service
  const secrets = yield* ChannelSecrets.Service
  const organizationId = yield* Seed.organization()
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
  return { workspace, token }
})

const signed = (body: object, at = Math.floor(Date.now() / 1000)) => {
  const text = JSON.stringify(body)
  return { headers: new Headers(SlackServer.sign(text, at)), body: text }
}

const callback = (event: object, extra: object = {}) => ({
  type: "event_callback",
  event_id: "Ev01",
  team_id: "T01",
  event,
  ...extra,
})

const authorized = { authorizations: [{ team_id: "T01", user_id: "UBOT" }] }

const parsed = (event: object) =>
  Effect.flatMap(provider, (slackProvider) => slackProvider.parse(signed(callback(event, authorized))))

const eventOf = (overrides: Partial<Channel.Event> = {}): Channel.Event => ({
  provider: "slack",
  eventId: "Ev01",
  install: "T01",
  place: { id: "C07", kind: "channel" },
  thread: { id: "C07:1.0" },
  message: "5.0",
  sender: { accountId: "T01:U01" },
  text: "why?",
  files: [],
  ...overrides,
})

describe("Slack", () => {
  it.live("a request needs Slack's signature over its timestamp and body, from the last 5 minutes", () =>
    Effect.gen(function* () {
      const slackProvider = yield* provider
      const good = signed({ type: "url_verification", challenge: "c" })
      yield* slackProvider.verify(good)
      expect(yield* Effect.flip(slackProvider.verify({ ...good, body: `${good.body} ` }))).toMatchObject({
        _tag: "ChannelProvider.Unauthorized",
      })
      expect(
        yield* Effect.flip(
          slackProvider.verify(signed({ type: "url_verification" }, Math.floor(Date.now() / 1000) - 301)),
        ),
      ).toMatchObject({ _tag: "ChannelProvider.Unauthorized" })
    }),
  )

  it.live(
    "url_verification answers the challenge; an uninstall or a revoked bot token removes the install of the authorizing team",
    () =>
      Effect.gen(function* () {
        const slackProvider = yield* provider
        expect(yield* slackProvider.parse(signed({ type: "url_verification", challenge: "abc" }))).toEqual({
          _tag: "Handshake",
          body: { challenge: "abc" },
        })
        expect(yield* slackProvider.parse(signed(callback({ type: "app_uninstalled" })))).toEqual({
          _tag: "Uninstalled",
          install: "T01",
        })
        expect(
          yield* slackProvider.parse(
            signed(
              callback({ type: "tokens_revoked", tokens: { bot: ["UBOT"] } }, { authorizations: [{ team_id: "T02" }] }),
            ),
          ),
        ).toEqual({ _tag: "Uninstalled", install: "T02" })
        expect(
          yield* slackProvider.parse(signed(callback({ type: "tokens_revoked", tokens: { oauth: ["U01"] } }))),
        ).toMatchObject({ _tag: "Ignore" })
      }),
  )

  it.live("places are the public and private channels on every page; more than 25 pages is an error", () =>
    Effect.gen(function* () {
      const slackProvider = yield* provider
      const found = yield* installed()
      slack.channels.splice(
        0,
        slack.channels.length,
        { id: "C3", name: "sales", is_private: true },
        { id: "C1", name: "eng", is_private: false },
        { id: "C2", name: "general", is_private: false },
      )
      slack.options.pageSize = 2
      expect(yield* slackProvider.places(found.workspace)).toEqual([
        { id: "C3", name: "sales", private: true, anyoneCanWrite: false },
        { id: "C1", name: "eng", private: false, anyoneCanWrite: false },
        { id: "C2", name: "general", private: false, anyoneCanWrite: false },
      ])
      expect(yield* slackProvider.place(found.workspace, "C3")).toEqual(
        Option.some({ id: "C3", name: "sales", private: true, anyoneCanWrite: false }),
      )
      expect(yield* slackProvider.place(found.workspace, "C9")).toEqual(Option.none())
      slack.channels.splice(
        0,
        slack.channels.length,
        ...Array.from({ length: 26 }, (_, index) => ({ id: `C${index}`, name: `c${index}`, is_private: false })),
      )
      slack.options.pageSize = 1
      expect(yield* Effect.flip(slackProvider.places(found.workspace))).toMatchObject({
        _tag: "ChannelProvider.Unavailable",
      })
      slack.options.pageSize = 200
    }),
  )

  it.live(
    "a mention or a DM is an event of the thread channel:thread_ts; a bot, Ren's own message, an edit and a channel message without a mention are ignored",
    () =>
      Effect.gen(function* () {
        expect(
          yield* parsed({
            type: "app_mention",
            user: "U01",
            team: "T01",
            channel: "C07",
            ts: "1712.40",
            thread_ts: "1712.33",
            text: "<@UBOT> the deploy failed",
          }),
        ).toEqual({
          _tag: "Event",
          event: {
            provider: "slack",
            eventId: "Ev01",
            install: "T01",
            place: { id: "C07", kind: "channel" },
            thread: { id: "C07:1712.33" },
            message: "1712.40",
            sender: { accountId: "T01:U01" },
            text: "the deploy failed",
            files: [],
          },
        })
        expect(
          yield* parsed({
            type: "message",
            channel_type: "im",
            subtype: "file_share",
            user: "U01",
            user_team: "T09",
            channel: "D01",
            ts: "1713.00",
            text: "here",
            files: [{ id: "F1", name: "a.log", mimetype: "text/plain", url_private_download: "https://f/1" }],
          }),
        ).toMatchObject({
          _tag: "Event",
          event: {
            place: { id: "D01", kind: "dm" },
            thread: { id: "D01:1713.00" },
            sender: { accountId: "T09:U01" },
            text: "here\n\n[file: a.log (text/plain)]",
            files: [{ url: "https://f/1", name: "a.log", mime: "text/plain" }],
          },
        })
        const message = { type: "message", channel_type: "im", user: "U01", channel: "D01", ts: "1713.00", text: "hi" }
        expect(
          yield* Effect.forEach(
            [
              { ...message, bot_id: "B01" },
              { ...message, user: "UBOT" },
              { ...message, subtype: "message_changed" },
              { ...message, channel_type: "channel" },
            ],
            parsed,
          ),
        ).toMatchObject([{ _tag: "Ignore" }, { _tag: "Ignore" }, { _tag: "Ignore" }, { _tag: "Ignore" }])
      }),
  )

  it.live(
    "before the route, Slack gives the names of people and channels, the sender, the channel and the thread's link",
    () =>
      Effect.gen(function* () {
        const slackProvider = yield* provider
        const found = yield* installed()
        slack.users.set("U01", { name: "ana", real_name: "Ana Lima" })
        slack.users.set("U02", { name: "ben", real_name: "Ben Silva" })
        slack.channels.splice(0, slack.channels.length, { id: "C07", name: "eng", is_private: false })
        if (!slackProvider.enrich) return yield* Effect.die(new Error("Slack has no enrich"))
        expect(
          yield* slackProvider.enrich(
            eventOf({
              install: found.workspace,
              thread: { id: "C07:1712.33" },
              text: "ping <@U02> and <@U09> in <#C07>",
            }),
          ),
        ).toMatchObject({
          text: "ping @Ben Silva and @U09 in #eng",
          sender: { accountId: "T01:U01", name: "Ana Lima", handle: "ana" },
          place: { id: "C07", name: "eng" },
          thread: { id: "C07:1712.33", url: `${slack.url}/archives/C07/p171233` },
        })
        expect(yield* slackProvider.enrich(eventOf({ install: "T-unknown", text: "ping <@U02>" }))).toMatchObject({
          text: "ping @U02",
        })
      }),
  )

  it.live(
    "the context is the thread since Ren's previous mention without Ren's own messages, and the latest 50 messages at most",
    () =>
      Effect.gen(function* () {
        const slackProvider = yield* provider
        const found = yield* installed()
        slack.users.set("U01", { name: "ana", real_name: "Ana Lima" })
        slack.users.set("U02", { name: "ben", real_name: "Ben Silva" })
        const reply = (ts: string, user: string, text: string) => ({ ts, user, text })
        slack.replies.splice(
          0,
          slack.replies.length,
          reply("1.0", "U01", "deploy?"),
          reply("2.0", "U02", "<@UBOT> check it"),
          reply("3.0", "UBOT", "On it"),
          reply("4.0", "U02", "it failed for <@U01>"),
          reply("5.0", "U01", "<@UBOT> why?"),
        )
        const event = eventOf({ install: found.workspace })
        expect(yield* slackProvider.context(event)).toEqual(Option.some("[Ben Silva] it failed for @Ana Lima"))
        slack.replies.splice(0, 2)
        expect(yield* slackProvider.context(event)).toEqual(Option.some("[Ben Silva] it failed for @Ana Lima"))
        slack.replies.splice(
          0,
          slack.replies.length,
          ...Array.from({ length: 60 }, (_, index) => reply(`${index + 1}.5`, "U01", `line ${index + 1}`)),
          reply("99.0", "U02", "<@UBOT> sum it up"),
        )
        const long = yield* slackProvider.context(eventOf({ install: found.workspace, message: "99.0" }))
        const lines = Option.getOrElse(long, () => "").split("\n")
        expect([lines.length, lines[0], lines[1], lines.at(-1)]).toEqual([
          51,
          "[earlier messages omitted]",
          "[Ana Lima] line 11",
          "[Ana Lima] line 60",
        ])
        slack.replies.splice(0, slack.replies.length, reply("5.0", "U01", "<@UBOT> why?"))
        expect(yield* slackProvider.context(event)).toEqual(Option.none())
      }),
  )

  it.live("context reports an incomplete thread when its page budget cannot reach the current message", () =>
    Effect.gen(function* () {
      const slackProvider = yield* provider
      const found = yield* installed()
      slack.replies.splice(
        0,
        slack.replies.length,
        ...Array.from({ length: 2001 }, (_, index) => ({
          ts: `${index + 1}.0`,
          user: "U01",
          text: `line ${index + 1}`,
        })),
      )
      expect(yield* slackProvider.context(eventOf({ install: found.workspace, message: "2002.0" }))).toEqual(
        Option.some("[Thread context omitted: the pagination limit was reached before the current message.]"),
      )
    }),
  )

  it.live("files declared over the size limit are refused before downloading", () =>
    Effect.gen(function* () {
      const slackProvider = yield* provider
      const found = yield* installed()
      const file = { url: `${slack.url}/files/F2`, name: "large.log", mime: "text/plain" }
      slack.files.set("F2", "small")
      expect(
        yield* Effect.flip(slackProvider.fetchFile(found.workspace, { ...file, size: Session.maxFileBytes + 1 })),
      ).toMatchObject({
        _tag: "ChannelProvider.FileUnavailable",
        message: "Slack file large.log exceeds the 10 MB limit",
      })
    }),
  )

  it.live("files with an underreported size are refused when the response exceeds the byte limit", () =>
    Effect.gen(function* () {
      const slackProvider = yield* provider
      const found = yield* installed()
      const file = { url: `${slack.url}/files/F2`, name: "large.log", mime: "text/plain" }
      slack.files.set("F2", "x".repeat(Session.maxFileBytes + 1))
      expect(yield* Effect.flip(slackProvider.fetchFile(found.workspace, { ...file, size: 1 }))).toMatchObject({
        _tag: "ChannelProvider.FileUnavailable",
        message: "Slack file exceeds the 10 MB limit",
      })
      slack.files.delete("F2")
    }),
  )

  it.live("a sender's email is their Slack profile's; a file downloads with the bot token, only from Slack", () =>
    Effect.gen(function* () {
      const slackProvider = yield* provider
      const found = yield* installed()
      slack.users.set("U01", { name: "ana", real_name: "Ana Lima", email: "ana@acme.test" })
      expect(yield* slackProvider.email(found.workspace, { accountId: "T01:U01" })).toEqual(
        Option.some("ana@acme.test"),
      )
      expect(yield* slackProvider.email(found.workspace, { accountId: "T01:U77" })).toEqual(Option.none())
      slack.files.set("F1", "the log")
      const bytes = yield* slackProvider.fetchFile(found.workspace, {
        url: `${slack.url}/files/F1`,
        name: "a.log",
        mime: "text/plain",
      })
      expect(new TextDecoder().decode(bytes)).toBe("the log")
      expect(
        yield* Effect.flip(
          slackProvider.fetchFile(found.workspace, {
            url: "https://evil.example.com/F1",
            name: "a",
            mime: "text/plain",
          }),
        ),
      ).toMatchObject({ _tag: "ChannelProvider.FileUnavailable" })
      expect(slackProvider.linkOf(eventOf({ thread: { id: "c07:1712.33" } }))).toEqual(
        Option.some({ kind: "slack_thread", key: "C07:1712.33" }),
      )
      expect(slackProvider.linkOf(eventOf({ place: { id: "D01", kind: "dm" } }))).toEqual(Option.none())
    }),
  )

  it.live(
    "a reply goes to its thread as one markdown block up to 11,000 characters, and longer as mrkdwn sections cut at paragraphs",
    () =>
      Effect.gen(function* () {
        const slackProvider = yield* provider
        const found = yield* installed()
        const target = { install: found.workspace, place: "eng", thread: "C07:1712.33", message: "1712.40" }
        const longest = "a".repeat(11_000)
        yield* slackProvider.send(target, longest)
        expect(slack.posted.at(-1)?.params).toEqual({
          channel: "C07",
          thread_ts: "1712.33",
          text: longest,
          blocks: JSON.stringify([{ type: "markdown", text: longest }]),
        })
        const paragraph = "word ".repeat(500).trim()
        yield* slackProvider.send(target, [paragraph, paragraph, paragraph, paragraph, paragraph].join("\n\n"))
        expect(slack.posted.at(-1)?.params.blocks).toBe(
          JSON.stringify(
            Array.from({ length: 5 }, () => ({ type: "section", text: { type: "mrkdwn", text: paragraph } })),
          ),
        )
        slack.options.postError = "channel_not_found"
        const gone = yield* Effect.flip(slackProvider.send(target, "again"))
        slack.options.postError = undefined
        expect(gone).toMatchObject({ _tag: "ChannelProvider.PlaceGone" })
      }),
  )

  it.live("a notice posts to the channel with the bot token; a channel the bot left is gone", () =>
    Effect.gen(function* () {
      const slackProvider = yield* provider
      const found = yield* installed()
      const place = { id: "C1", name: "eng", private: false, anyoneCanWrite: false }
      yield* slackProvider.announce(found.workspace, place, "Ren answers here for Eng")
      expect(slack.posted.at(-1)).toEqual({
        method: "chat.postMessage",
        token: found.token,
        params: { channel: "C1", text: "Ren answers here for Eng" },
      })
      slack.options.postError = "not_in_channel"
      const gone = yield* Effect.flip(slackProvider.announce(found.workspace, place, "again"))
      slack.options.postError = undefined
      expect(gone).toMatchObject({ _tag: "ChannelProvider.PlaceGone" })
    }),
  )
})
