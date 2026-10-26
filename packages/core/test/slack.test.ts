import { afterAll, describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { ChannelInstall } from "@ren/schema/channel-install"
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
