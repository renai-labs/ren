import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Agent } from "@ren/schema/agent"
import { Session } from "@ren/schema/session"
import { Webhook } from "@ren/schema/webhook"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import type { Actor } from "../src/actor.js"
import { Webhooks } from "../src/webhooks.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"
import { WebhookFixture } from "./lib/webhook-fixture.js"

const it = testEffect(WebhookFixture.layer)

const live = WebhookFixture.decodeUpdate({ mode: "live" })

describe("Webhooks", () => {
  it.live("an agent in a chat creates a listening webhook on its own agent, and gets a URL with a token", () =>
    Effect.gen(function* () {
      const webhooks = yield* Webhooks.Service
      const t = yield* WebhookFixture.team
      const agentId = yield* Seed.agent(t, "researcher", { isSubagent: false })
      const inChat: Actor.Info = {
        ...t.ada,
        agent: { agentId, sessionId: Session.ID.create(), spaceId: t.spaceId, fence: null },
      }
      const created = yield* webhooks.create(inChat, WebhookFixture.signups(t.spaceId))
      expect(created).toMatchObject({
        mode: "listening",
        modeReason: null,
        ownerId: t.createdBy,
        fallbackUserId: null,
        agentId,
        slug: "posthog-signups",
        name: "PostHog signups",
        preset: null,
        hasSigningSecret: false,
        lastRequest: null,
      })
      expect(created.url).toMatch(new RegExp(`^https://ren\\.test/webhooks/${created.id}/[A-Za-z0-9_-]{32,}$`, "u"))
      expect(yield* webhooks.get(t.bob, created.id)).toEqual(created)
    }),
  )

  it.live(
    "a global agent is never stored: naming it is refused, and a chat on it creates a webhook on the space default",
    () =>
      Effect.gen(function* () {
        const webhooks = yield* Webhooks.Service
        const database = yield* Database.Service
        const t = yield* WebhookFixture.team
        const ren = Agent.ID.create()
        yield* database.db.insert(Database.Schema.agent).values({ id: ren, name: "ren", is_subagent: false })
        const named = yield* Effect.flip(webhooks.create(t.ada, { ...WebhookFixture.signups(t.spaceId), agentId: ren }))
        expect(named).toMatchObject({
          _tag: "Primitive.Invalid",
          message: "ren is the space default. Leave the agent empty to use it.",
        })
        const unknown = yield* Effect.flip(
          webhooks.create(t.ada, { ...WebhookFixture.signups(t.spaceId), agentId: Agent.ID.create() }),
        )
        expect(unknown).toMatchObject({ _tag: "Primitive.NotFound", message: "Agent not found in this space." })
        const inChat: Actor.Info = {
          ...t.ada,
          agent: { agentId: ren, sessionId: Session.ID.create(), spaceId: t.spaceId, fence: null },
        }
        const created = yield* webhooks.create(inChat, WebhookFixture.signups(t.spaceId))
        expect(created.agentId).toBeNull()
        expect(yield* Effect.flip(webhooks.update(t.ada, created.id, { agentId: ren }))).toMatchObject({
          _tag: "Primitive.Invalid",
        })
      }),
  )

  it.live("a parser expression that does not compile is refused, with its field", () =>
    Effect.gen(function* () {
      const webhooks = yield* Webhooks.Service
      const t = yield* WebhookFixture.team
      const refused = yield* Effect.flip(
        webhooks.create(
          t.ada,
          WebhookFixture.decodeCreate({
            spaceId: t.spaceId,
            source: { _tag: "custom", name: "Broken", message: "Hi.", parser: { filter: "body.x ==" } },
          }),
        ),
      )
      expect(refused).toMatchObject({ _tag: "Primitive.Invalid", field: "parser.filter" })
      expect((yield* webhooks.list(t.ada, { spaceId: t.spaceId, page: 1, pageSize: 50 })).items).toEqual([])
    }),
  )

  it.live("two creates with one slug at the same time give one webhook and one 409", () =>
    Effect.gen(function* () {
      const webhooks = yield* Webhooks.Service
      const t = yield* WebhookFixture.team
      const input = { ...WebhookFixture.signups(t.spaceId), slug: "signups" }
      const results = yield* Effect.all(
        [webhooks.create(t.ada, input), webhooks.create(t.bob, input)].map(Effect.result),
        {
          concurrency: "unbounded",
        },
      )
      expect(results.map((result) => (result._tag === "Success" ? "created" : result.failure._tag)).toSorted()).toEqual(
        ["Primitive.Conflict", "created"],
      )
    }),
  )

  it.live(
    "a webhook whose signature needs a secret goes live only after a secret is set; Ren makes it and reveals it",
    () =>
      Effect.gen(function* () {
        const webhooks = yield* Webhooks.Service
        const t = yield* WebhookFixture.team
        const created = yield* webhooks.create(t.ada, WebhookFixture.signups(t.spaceId))
        expect(yield* Effect.flip(webhooks.update(t.ada, created.id, live))).toMatchObject({
          _tag: "Primitive.Invalid",
          field: "mode",
        })
        const set = yield* webhooks.setSigningSecret(t.ada, created.id, {})
        expect(set.record.hasSigningSecret).toBe(true)
        expect(set.secret.length).toBeGreaterThanOrEqual(32)
        expect((yield* webhooks.revealSigningSecret(t.bob, created.id, {})).secret).toBe(set.secret)
        expect(yield* webhooks.update(t.ada, created.id, live)).toMatchObject({ mode: "live", modeReason: null })
      }),
  )

  it.live("a change to the message, parser or agent makes the changer the owner; a name or mode change does not", () =>
    Effect.gen(function* () {
      const webhooks = yield* Webhooks.Service
      const t = yield* WebhookFixture.team
      const created = yield* webhooks.create(
        t.ada,
        WebhookFixture.decodeCreate({
          spaceId: t.spaceId,
          source: { _tag: "custom", name: "Signups", message: "Research this person." },
        }),
      )
      expect(
        yield* webhooks.update(t.bob, created.id, WebhookFixture.decodeUpdate({ name: "New signups", mode: "live" })),
      ).toMatchObject({ ownerId: t.createdBy, mode: "live" })
      expect(
        yield* webhooks.update(t.bob, created.id, WebhookFixture.decodeUpdate({ message: "Say hello." })),
      ).toMatchObject({ ownerId: t.bob.userId })
    }),
  )

  it.live("a person sets only themselves as the fallback user, and can remove it", () =>
    Effect.gen(function* () {
      const webhooks = yield* Webhooks.Service
      const t = yield* WebhookFixture.team
      const created = yield* webhooks.create(t.ada, WebhookFixture.signups(t.spaceId))
      expect(yield* Effect.flip(webhooks.update(t.bob, created.id, { fallbackUserId: t.ada.userId }))).toMatchObject({
        _tag: "Primitive.Invalid",
        field: "fallbackUserId",
      })
      expect(yield* webhooks.update(t.bob, created.id, { fallbackUserId: t.bob.userId })).toMatchObject({
        ownerId: t.createdBy,
        fallbackUserId: t.bob.userId,
      })
      expect(yield* webhooks.update(t.ada, created.id, { fallbackUserId: null })).toMatchObject({
        fallbackUserId: null,
      })
    }),
  )

  it.live("rotating the URL replaces its token, and an archived webhook is gone", () =>
    Effect.gen(function* () {
      const webhooks = yield* Webhooks.Service
      const t = yield* WebhookFixture.team
      const created = yield* webhooks.create(t.ada, WebhookFixture.signups(t.spaceId))
      const rotated = yield* webhooks.rotateUrl(t.ada, created.id, {})
      expect(rotated.url).not.toBe(created.url)
      expect(rotated.url.startsWith(`https://ren.test/webhooks/${created.id}/`)).toBe(true)
      yield* webhooks.archive(t.ada, created.id)
      expect(yield* Effect.flip(webhooks.get(t.ada, created.id))).toMatchObject({ _tag: "Primitive.NotFound" })
    }),
  )

  it.live("a member outside the space does not see its webhooks", () =>
    Effect.gen(function* () {
      const webhooks = yield* Webhooks.Service
      const t = yield* WebhookFixture.team
      const outsider = yield* Seed.actor(t.organizationId, "member")
      const created = yield* webhooks.create(t.ada, WebhookFixture.signups(t.spaceId))
      expect(yield* Effect.flip(webhooks.get(outsider, created.id))).toMatchObject({ _tag: "Primitive.NotFound" })
      expect((yield* webhooks.list(outsider, { page: 1, pageSize: 50 })).items).toEqual([])
    }),
  )

  it.live("the list shows the newest request of each webhook; requests list without the body, get with it", () =>
    Effect.gen(function* () {
      const webhooks = yield* Webhooks.Service
      const database = yield* Database.Service
      const t = yield* WebhookFixture.team
      const created = yield* webhooks.create(t.ada, WebhookFixture.signups(t.spaceId))
      const requestOf = (receivedAt: Date, outcome: Webhook.RequestOutcome, body: string) => ({
        id: Webhook.RequestID.create(),
        webhook_id: created.id,
        received_at: receivedAt,
        outcome,
        verified: true,
        method: "POST",
        headers: { "content-type": "application/json", "x-ren-secret": "[hidden]" },
        body,
      })
      const older = requestOf(new Date("2026-11-07T10:00:00Z"), "recorded", '{"n":1}')
      const newer = requestOf(new Date("2026-11-07T10:01:00Z"), "ignored", '{"n":22}')
      yield* database.db.insert(Database.Schema.webhook_request).values([older, newer])
      const listed = yield* webhooks.list(t.bob, { spaceId: t.spaceId, page: 1, pageSize: 50 })
      expect(listed.items.map((item) => item.lastRequest)).toMatchObject([{ id: newer.id, outcome: "ignored" }])
      const requests = yield* webhooks.requests.list(t.bob, { webhookId: created.id, page: 1, pageSize: 20 })
      expect(requests.items.map((item) => [item.id, item.bodyBytes])).toEqual([
        [newer.id, 8],
        [older.id, 7],
      ])
      expect(requests.items[0]).not.toHaveProperty("body")
      expect(yield* webhooks.requests.get(t.bob, older.id, {})).toMatchObject({
        body: '{"n":1}',
        headers: { "x-ren-secret": "[hidden]" },
      })
    }),
  )
})

describe("Webhook presets", () => {
  it.live("a person turns on a preset of an app the space reaches; it reads the app, and turns on once", () =>
    Effect.gen(function* () {
      const webhooks = yield* Webhooks.Service
      const t = yield* WebhookFixture.team
      const appId = yield* WebhookFixture.presetApp(t.organizationId, { "pull-requests": WebhookFixture.pullRequests })
      const turnOn = WebhookFixture.decodeCreate({
        spaceId: t.spaceId,
        source: { _tag: "preset", appId, preset: "pull-requests" },
      })
      const created = yield* webhooks.create(t.bob, turnOn)
      expect(created).toMatchObject({
        mode: "listening",
        ownerId: t.bob.userId,
        name: "Pull requests",
        message: "Review this pull request.",
        parser: { threadKey: "body.pull_request.html_url" },
        preset: { appId, appName: "GitHub", preset: "pull-requests", secret: "ren" },
        hasSigningSecret: true,
      })
      expect(yield* Effect.flip(webhooks.create(t.ada, turnOn))).toMatchObject({ _tag: "Primitive.Conflict" })
      expect(
        yield* Effect.flip(webhooks.update(t.ada, created.id, WebhookFixture.decodeUpdate({ message: "Hi." }))),
      ).toMatchObject({ _tag: "Primitive.Invalid", field: "message" })
      expect(yield* webhooks.update(t.ada, created.id, { agentId: null })).toMatchObject({ ownerId: t.ada.userId })
    }),
  )

  it.live("a publisher change shows at once, and a removed preset shows with no message or parser", () =>
    Effect.gen(function* () {
      const webhooks = yield* Webhooks.Service
      const database = yield* Database.Service
      const t = yield* WebhookFixture.team
      const appId = yield* WebhookFixture.presetApp(t.organizationId, { "pull-requests": WebhookFixture.pullRequests })
      const created = yield* webhooks.create(
        t.ada,
        WebhookFixture.decodeCreate({ spaceId: t.spaceId, source: { _tag: "preset", appId, preset: "pull-requests" } }),
      )
      const app = Database.Schema.app
      yield* database.db
        .update(app)
        .set({ webhooks: { "pull-requests": { ...WebhookFixture.pullRequests, message: "Review it twice." } } })
        .where(eq(app.id, appId))
      expect(yield* webhooks.get(t.ada, created.id)).toMatchObject({ message: "Review it twice." })
      yield* database.db.update(app).set({ webhooks: {} }).where(eq(app.id, appId))
      expect(yield* webhooks.get(t.ada, created.id)).toMatchObject({
        name: "pull-requests",
        message: null,
        parser: null,
        preset: { appId, secret: null, setup: null },
      })
    }),
  )

  it.live("a space that does not reach the app cannot turn on its preset", () =>
    Effect.gen(function* () {
      const webhooks = yield* Webhooks.Service
      const t = yield* WebhookFixture.team
      const other = yield* Seed.organization()
      const appId = yield* WebhookFixture.presetApp(other, { "pull-requests": WebhookFixture.pullRequests })
      expect(
        yield* Effect.flip(
          webhooks.create(
            t.ada,
            WebhookFixture.decodeCreate({
              spaceId: t.spaceId,
              source: { _tag: "preset", appId, preset: "pull-requests" },
            }),
          ),
        ),
      ).toMatchObject({ _tag: "Primitive.NotFound" })
    }),
  )
})
