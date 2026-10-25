import { afterAll, describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer, Option, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { createHmac } from "node:crypto"
import { GitHub } from "../src/channel-provider/github.js"
import { GitHubApp } from "../src/github-app.js"
import { testEffect } from "./lib/effect.js"
import { GitHubServer } from "./lib/github-server.js"

const github = GitHubServer.start()
afterAll(() => github.stop())

const settings = (overrides: Record<string, string> = {}) =>
  ConfigProvider.layer(
    ConfigProvider.fromUnknown(GitHubServer.config(github.url, { GITHUB_URL: "https://github.com", ...overrides })),
  )

const client = Effect.gen(function* () {
  const found = yield* GitHubApp.settings
  if (Option.isNone(found)) return yield* Effect.die(new Error("The GitHub App settings did not load"))
  return yield* GitHubApp.make(found.value)
})

const app = testEffect(Layer.mergeAll(FetchHttpClient.layer, settings()))

const encoded = testEffect(
  Layer.mergeAll(
    FetchHttpClient.layer,
    settings({ GITHUB_APP_PRIVATE_KEY: Buffer.from(GitHubServer.privateKey).toString("base64") }),
  ),
)

const installation = (login: string) => {
  const id = String(Math.floor(Math.random() * 1e9))
  github.installations.set(id, login)
  return id
}

const sign = (body: string, secret = "webhook-secret") =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`

const request = (event: string, body: string, signature: string | null = sign(body)) => ({
  headers: new Headers({
    "x-github-event": event,
    "x-github-delivery": "d-1",
    ...(signature !== null && { "x-hub-signature-256": signature }),
  }),
  body,
})

const octocat = { id: 583231, login: "octocat", type: "User" }

const commented = (
  event: "issue_comment" | "pull_request_review_comment",
  overrides: {
    readonly action?: string
    readonly body?: string
    readonly from?: string
    readonly sender?: object
  } = {},
) => {
  const item = { number: 12, html_url: "https://github.com/acme/api/issues/12" }
  return request(
    event,
    JSON.stringify({
      action: overrides.action ?? "created",
      installation: { id: 77 },
      sender: overrides.sender ?? octocat,
      repository: { id: 8812, full_name: "acme/api" },
      comment: { id: 456, body: overrides.body ?? "@ren-test why does the deploy fail?" },
      ...(overrides.from !== undefined && { changes: { body: { from: overrides.from } } }),
      ...(event === "issue_comment" ? { issue: item } : { pull_request: item }),
    }),
  )
}

describe("GitHub", () => {
  app.live("verify refuses a bad, missing or other-secret signature and accepts the App's", () =>
    Effect.gen(function* () {
      const provider = GitHub.make(yield* client)
      const body = JSON.stringify({ zen: "Keep it logically awesome." })
      const outcomes = yield* Effect.forEach(
        [sign(body), "sha256=00", null, sign(body, "other-secret"), sign(`${body} `)],
        (signature) => Effect.exit(provider.verify(request("ping", body, signature))),
      )
      expect(outcomes.map((exit) => exit._tag)).toEqual(["Success", "Failure", "Failure", "Failure", "Failure"])
    }),
  )

  app.live("parse: ping is a handshake, installation deleted is an uninstall, and other events are ignored", () =>
    Effect.gen(function* () {
      const provider = GitHub.make(yield* client)
      expect(yield* provider.parse(request("ping", JSON.stringify({ zen: "z", hook_id: 1 })))).toEqual({
        _tag: "Handshake",
        body: {},
      })
      expect(
        yield* provider.parse(request("installation", JSON.stringify({ action: "deleted", installation: { id: 77 } }))),
      ).toEqual({ _tag: "Uninstalled", install: "77" })
      expect(
        yield* provider.parse(request("installation", JSON.stringify({ action: "created", installation: { id: 77 } }))),
      ).toMatchObject({ _tag: "Ignore" })
      expect((yield* Effect.flip(provider.parse(request("ping", "not json"))))._tag).toBe("ChannelProvider.Malformed")
    }),
  )

  app.live("a mention on an issue, a pull request or a diff line is an event of the thread repository:number", () =>
    Effect.gen(function* () {
      const provider = GitHub.make(yield* client)
      const thread = { id: "8812:12", url: "https://github.com/acme/api/issues/12" }
      expect(yield* provider.parse(commented("issue_comment"))).toEqual({
        _tag: "Event",
        event: {
          provider: "github",
          eventId: "d-1",
          install: "77",
          place: { id: "8812", kind: "repository", name: "acme/api" },
          thread,
          message: "issue:456",
          sender: { accountId: "583231", handle: "octocat" },
          text: "@ren-test why does the deploy fail?",
          files: [],
        },
      })
      expect(yield* provider.parse(commented("pull_request_review_comment"))).toMatchObject({
        _tag: "Event",
        event: { thread, message: "review:456" },
      })
      const mentions = yield* Effect.forEach(
        ["@REN-TEST look", "ask @ren-test[bot].", "@ren-tester look", "mail me@ren-test", "no mention"],
        (body) => provider.parse(commented("issue_comment", { body })),
      )
      expect(mentions.map((parsed) => parsed._tag)).toEqual(["Event", "Event", "Ignore", "Ignore", "Ignore"])
    }),
  )

  app.live("a comment from a bot or from the App's own bot user is ignored", () =>
    Effect.gen(function* () {
      const provider = GitHub.make(yield* client)
      const senders = [
        { id: 41898282, login: "github-actions[bot]", type: "Bot" },
        { id: 9001, login: "renamed-app[bot]", type: "User" },
      ]
      const parsed = yield* Effect.forEach(senders, (sender) => provider.parse(commented("issue_comment", { sender })))
      expect(parsed.map((each) => each._tag)).toEqual(["Ignore", "Ignore"])
    }),
  )

  app.live("an edit is an event only when it adds the first mention", () =>
    Effect.gen(function* () {
      const provider = GitHub.make(yield* client)
      const edits = yield* Effect.forEach(
        [{ from: "why does the deploy fail?" }, { from: "@ren-test why?" }, {}],
        (edit) => provider.parse(commented("issue_comment", { action: "edited", ...edit })),
      )
      expect(edits.map((each) => each._tag)).toEqual(["Event", "Ignore", "Ignore"])
      expect((yield* provider.parse(commented("issue_comment", { action: "deleted" })))._tag).toBe("Ignore")
    }),
  )

  app.live("the context names the issue or pull request, its state and branches, and the triggering comment", () =>
    Effect.gen(function* () {
      const provider = GitHub.make(yield* client)
      const install = installation("acme")
      github.resources.set("/repos/acme/api/issues/12", { title: "The deploy fails", state: "open" })
      github.resources.set("/repos/acme/api/issues/comments/456", { user: { login: "octocat" } })
      github.resources.set("/repos/acme/api/issues/41", { title: "Fix the deploy", state: "open", pull_request: {} })
      github.resources.set("/repos/acme/api/pulls/41", {
        title: "Fix the deploy",
        state: "open",
        draft: true,
        merged: false,
        head: { ref: "fix-deploy" },
        base: { ref: "main" },
      })
      github.resources.set("/repos/acme/api/pulls/comments/789", { user: { login: "hubot" } })
      const parsed = yield* provider.parse(commented("issue_comment"))
      if (parsed._tag !== "Event") return yield* Effect.die(new Error("The mention did not parse"))
      const event = { ...parsed.event, install }
      expect(yield* provider.context(event)).toEqual(
        Option.some("Issue #12 “The deploy fails”, open\nTriggering comment: 456 (issue) by @octocat"),
      )
      expect(yield* provider.context({ ...event, thread: { id: "8812:41" }, message: "review:789" })).toEqual(
        Option.some(
          "Pull request #41 “Fix the deploy”, draft, fix-deploy → main\nTriggering comment: 789 (review) by @hubot",
        ),
      )
      expect(github.minted.filter((each) => each === install)).toHaveLength(1)
      expect((yield* Effect.flip(provider.context({ ...event, thread: { id: "8812:404" } })))._tag).toBe(
        "ChannelProvider.Unavailable",
      )
    }),
  )

  app.live(
    "a reply is an issue comment, or a reply in the review thread of a diff-line comment, posted as the App",
    () =>
      Effect.gen(function* () {
        const provider = GitHub.make(yield* client)
        const install = installation("acme")
        const target = { install, place: "acme/api", thread: "8812:41" }
        yield* provider.send({ ...target, message: "issue:456" }, "Rolled back.")
        yield* provider.send({ ...target, message: "review:789" }, "Fixed on this line.")
        expect(github.posted.slice(-2)).toEqual([
          {
            path: "/repos/acme/api/issues/41/comments",
            body: { body: "Rolled back." },
            authorization: expect.stringMatching(/^Bearer ghs_/u),
          },
          {
            path: "/repos/acme/api/pulls/41/comments/789/replies",
            body: { body: "Fixed on this line." },
            authorization: expect.stringMatching(/^Bearer ghs_/u),
          },
        ])
        const failures = yield* Effect.forEach([404, 422, 502], (status) =>
          Effect.sync(() => (github.options.postStatus = status)).pipe(
            Effect.andThen(Effect.flip(provider.send({ ...target, message: "issue:456" }, "again"))),
          ),
        ).pipe(Effect.ensuring(Effect.sync(() => (github.options.postStatus = 201))))
        expect(failures.map((error) => error._tag)).toEqual([
          "ChannelProvider.PlaceGone",
          "ChannelProvider.Rejected",
          "ChannelProvider.Unavailable",
        ])
      }),
  )

  app.effect("the App JWT is issued 60 seconds in the past and expires within 10 minutes", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_800_000_000_000)
      const claims = GitHubServer.claimsOf(yield* (yield* client).jwt)
      expect(claims).toEqual({ iat: 1_800_000_000 - 60, exp: 1_800_000_000 + 540, iss: GitHubServer.appId })
    }),
  )

  encoded.live("a private key given as base64 of the PEM signs a JWT that GitHub accepts", () =>
    Effect.gen(function* () {
      const id = installation("acme")
      expect(yield* (yield* client).installation(id)).toEqual({ id: Number(id), account: { login: "acme" } })
    }),
  )

  app.effect("an installation token is kept until 5 minutes before it expires, then minted again", () =>
    Effect.gen(function* () {
      const minter = yield* client
      const id = installation("acme")
      const expiresAt = Date.parse(github.options.tokenExpiresAt)
      yield* TestClock.setTime(expiresAt - 60 * 60_000)
      const first = yield* minter.token(id)
      expect(first.expiresAt).toBe(expiresAt)
      yield* TestClock.setTime(expiresAt - 5 * 60_000 - 1)
      expect(Redacted.value((yield* minter.token(id)).token)).toBe(Redacted.value(first.token))
      yield* TestClock.setTime(expiresAt - 5 * 60_000)
      expect(Redacted.value((yield* minter.token(id)).token)).not.toBe(Redacted.value(first.token))
      expect(github.minted.filter((each) => each === id)).toHaveLength(2)
    }),
  )

  app.live("without GITHUB_APP_ID, GitHub is off", () =>
    Effect.gen(function* () {
      expect(Option.isNone(yield* GitHubApp.settings)).toBe(true)
    }).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({})))),
  )
})
