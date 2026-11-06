import { describe, expect, setDefaultTimeout } from "bun:test"
import { Database } from "@ren/db/database"
import { Session } from "@ren/schema/session"
import { Webhook } from "@ren/schema/webhook"
import { WebhookDelivery } from "@ren/schema/webhook-delivery"
import { asc, eq } from "drizzle-orm"
import { Effect, Schedule, Schema } from "effect"
import { WebhookIntake } from "../src/webhook-intake.js"
import { WebhookSignature } from "../src/webhook-signature.js"
import { Webhooks } from "../src/webhooks.js"
import { ChannelFixture } from "./lib/channel-fixture.js"
import { Seed } from "./lib/seed.js"
import { WebhookFixture } from "./lib/webhook-fixture.js"
import { testEffect } from "./lib/effect.js"

setDefaultTimeout(60_000)

const it = testEffect(WebhookFixture.layer)

const decodeCreate = WebhookFixture.decodeCreate

const owner = WebhookFixture.owner

const post = WebhookFixture.post

const deliveriesOf = (webhookId: Webhook.ID) =>
  Effect.flatMap(Database.Service, (database) =>
    database.db
      .select()
      .from(Database.Schema.webhook_delivery)
      .where(eq(Database.Schema.webhook_delivery.webhook_id, webhookId))
      .orderBy(asc(Database.Schema.webhook_delivery.received_at), asc(Database.Schema.webhook_delivery.id)),
  )

const settled = (webhookId: Webhook.ID, deliveryId: WebhookDelivery.ID | undefined) =>
  deliveriesOf(webhookId).pipe(
    Effect.map((rows) => rows.find((row) => row.id === deliveryId)),
    Effect.repeat({
      until: (row) => Boolean(row?.session_id) || row?.outcome === "failed",
      schedule: Schedule.spaced("20 millis"),
    }),
    Effect.timeoutOrElse({
      duration: "20 seconds",
      orElse: () => Effect.die(new Error(`The delivery ${deliveryId} did not settle`)),
    }),
    Effect.flatMap((row) => (row ? Effect.succeed(row) : Effect.die(new Error(`No delivery ${deliveryId}`)))),
  )

const signup = (email: string, event = "user signed up") =>
  JSON.stringify({ event: { event, uuid: crypto.randomUUID() }, person: { properties: { email } } })

describe("WebhookIntake", () => {
  it.live(
    "a GitHub ping to a listening webhook is recorded unverified before the secret, and a wrong signature is rejected with headers only",
    () =>
      Effect.gen(function* () {
        const t = yield* owner
        const webhooks = yield* Webhooks.Service
        const created = yield* webhooks.create(
          t.actor,
          decodeCreate({
            spaceId: t.spaceId,
            name: "Pull requests",
            message: "Review this pull request.",
            parser: { signature: { kind: "hmac", header: "x-hub-signature-256", prefix: "sha256=", encoding: "hex" } },
          }),
        )
        const ping = JSON.stringify({ zen: "Keep it simple.", hook_id: 1 })
        expect(yield* post(created.url, ping, { "x-github-event": "ping" })).toEqual({ status: 202 })
        const secret = (yield* webhooks.setSigningSecret(t.actor, created.id, {})).secret
        const signed = `sha256=${WebhookSignature.hmac(secret, ping, "hex")}`
        expect(yield* post(created.url, ping, { "x-hub-signature-256": signed })).toEqual({ status: 202 })
        expect(yield* post(created.url, ping, { "x-hub-signature-256": "sha256=00" })).toEqual({ status: 401 })
        expect(yield* post(`${created.url}x`, ping)).toEqual({ status: 404 })
        expect(yield* deliveriesOf(created.id)).toMatchObject([
          { outcome: "recorded", verified: false, body: ping },
          { outcome: "recorded", verified: true, body: ping },
          { outcome: "rejected", verified: false, body: null, reason: "wrong signature" },
        ])
      }),
  )

  it.live(
    "a live webhook starts a chat as its owner for a signup, continues it for the same person, and ignores a pageview",
    () =>
      Effect.gen(function* () {
        const t = yield* owner
        const webhooks = yield* Webhooks.Service
        const created = yield* webhooks.create(
          t.actor,
          decodeCreate({
            spaceId: t.spaceId,
            name: "PostHog signups",
            message: "Research this person’s company.",
            parser: {
              filter: 'body.event.event == "user signed up"',
              eventId: "body.event.uuid",
              threadKey: "body.person.properties.email",
              title: "body.person.properties.email",
            },
          }),
        )
        yield* webhooks.update(t.actor, created.id, { mode: "live" })
        const first = signup("jane@acme.com")
        expect(
          yield* post(created.url, first, {
            "x-forwarded-for": "203.0.113.7",
            "x-forwarded-proto": "https",
            "x-amzn-trace-id": "Root=1-6543-abc",
            "cf-ray": "a565943c887f8026-MAA",
          }),
        ).toEqual({ status: 202 })
        expect(yield* post(created.url, first)).toEqual({ status: 200 })
        expect(yield* post(created.url, signup("jane@acme.com", "pageview"))).toEqual({ status: 200 })
        const rows = yield* deliveriesOf(created.id)
        const started = yield* settled(created.id, rows[0]?.id)
        expect(yield* post(created.url, signup("jane@acme.com"))).toEqual({ status: 202 })
        const continued = (yield* deliveriesOf(created.id)).at(-1)
        yield* settled(created.id, continued?.id)
        expect((yield* deliveriesOf(created.id)).map((row) => [row.outcome, row.broken, row.session_id])).toEqual([
          ["started", false, started.session_id],
          ["duplicate", false, null],
          ["ignored", false, null],
          ["continued", false, started.session_id],
        ])
        const accepted = yield* ChannelFixture.accepted(2)
        expect(accepted).toMatchObject([
          { kind: "start", interactive: false, webhook: { webhookId: created.id, name: "PostHog signups" } },
          { kind: "send", delivery: "queue", sessionId: started.session_id },
        ])
        expect(accepted[0]?.prompt.text).toBe(
          `Research this person’s company.\n\n<webhook_request>\nheaders:\n  content-type: application/json\nbody:\n${first}\n</webhook_request>`,
        )
        const database = yield* Database.Service
        expect(
          yield* database.db
            .select({
              title: Database.Schema.agent_session.start_input,
              createdBy: Database.Schema.agent_session.created_by,
            })
            .from(Database.Schema.agent_session)
            .where(eq(Database.Schema.agent_session.id, started.session_id ?? Session.ID.create())),
        ).toMatchObject([{ title: { title: "jane@acme.com" }, createdBy: t.createdBy }])
      }),
  )

  it.live("a handshake answers a challenge before the signature check; a GET that it does not answer is 405", () =>
    Effect.gen(function* () {
      const t = yield* owner
      const webhooks = yield* Webhooks.Service
      const created = yield* webhooks.create(
        t.actor,
        decodeCreate({
          spaceId: t.spaceId,
          name: "Graph",
          message: "Read the change.",
          parser: {
            signature: { kind: "header", header: "x-ren-secret" },
            handshake:
              'has(query.validationToken) ? {"status": 200, "contentType": "text/plain", "body": query.validationToken} : null',
          },
        }),
      )
      expect(yield* post(`${created.url}?validationToken=abc`, "")).toEqual({
        status: 200,
        contentType: "text/plain",
        body: "abc",
      })
      expect(yield* post(created.url, "", {}, "GET")).toEqual({ status: 405 })
      expect((yield* deliveriesOf(created.id)).map((row) => row.outcome)).toEqual(["answered"])
    }),
  )

  it.live("the 61st request in a minute is throttled and kept with its body (W31)", () =>
    Effect.gen(function* () {
      const t = yield* owner
      const webhooks = yield* Webhooks.Service
      const database = yield* Database.Service
      const created = yield* webhooks.create(
        t.actor,
        decodeCreate({ spaceId: t.spaceId, name: "Busy", message: "Go." }),
      )
      yield* database.db.insert(Database.Schema.webhook_delivery).values(
        Array.from({ length: WebhookIntake.perMinute }, () => ({
          id: WebhookDelivery.ID.create(),
          webhook_id: created.id,
          outcome: "recorded" as const,
          verified: true,
          method: "POST",
          headers: {},
          body: "{}",
        })),
      )
      expect(yield* post(created.url, '{"n":61}')).toEqual({ status: 429 })
      expect((yield* deliveriesOf(created.id)).filter((row) => row.outcome === "throttled")).toMatchObject([
        { body: '{"n":61}' },
      ])
    }),
  )

  it.live("test explains what the parser in the form would do with each recorded request, and saves nothing", () =>
    Effect.gen(function* () {
      const t = yield* owner
      const webhooks = yield* Webhooks.Service
      const created = yield* webhooks.create(
        t.actor,
        decodeCreate({ spaceId: t.spaceId, name: "Signups", message: "Go." }),
      )
      const bodies = [signup("ada@acme.com"), signup("ada@acme.com", "pageview"), JSON.stringify({ type: "other" })]
      yield* Effect.forEach(bodies, (body) => post(created.url, body))
      const parser = Schema.decodeUnknownSync(Webhook.Parser)({
        filter: 'body.event.event == "user signed up"',
        threadKey: "body.person.properties.email",
      })
      const tested = yield* webhooks.test(t.actor, { webhookId: created.id, parser })
      expect(tested.items.map((item) => [item.outcome, item.broken, item.reason, item.threadKey])).toEqual([
        ["ignored", true, "filter: field not found: event", null],
        ["ignored", false, "filter is false", null],
        ["started", false, null, "ada@acme.com"],
      ])
      expect((yield* deliveriesOf(created.id)).map((row) => row.outcome)).toEqual(["recorded", "recorded", "recorded"])
    }),
  )

  it.live(
    "5 broken requests in a row switch a live webhook to listening and start one repair chat; after the fix, replay starts the chats of the kept requests (spec section 1)",
    () =>
      Effect.gen(function* () {
        const t = yield* owner
        const webhooks = yield* Webhooks.Service
        const created = yield* webhooks.create(
          t.actor,
          decodeCreate({
            spaceId: t.spaceId,
            name: "PostHog signups",
            message: "Research this person’s company.",
            parser: { filter: 'body.evt.name == "user signed up"', threadKey: "body.person.properties.email" },
          }),
        )
        yield* webhooks.update(t.actor, created.id, { mode: "live" })
        const emails = Array.from({ length: 6 }, (_, index) => `person${index}@acme.com`)
        const replies = yield* Effect.forEach(emails.slice(0, 5), (email) => post(created.url, signup(email)))
        expect(replies).toEqual(Array.from({ length: 5 }, () => ({ status: 200 })))
        const broken = yield* webhooks.get(t.actor, created.id)
        expect([broken.mode, broken.modeReason]).toEqual(["listening", "parser_broken"])
        const repair = (yield* ChannelFixture.accepted(1)).at(0)
        expect(repair).toMatchObject({ kind: "start", interactive: false })
        expect(repair?.prompt.text).toContain(`The parser of the webhook “PostHog signups” (${created.id}) broke`)
        expect(yield* post(created.url, signup(emails.at(5) ?? ""))).toEqual({ status: 202 })
        expect((yield* deliveriesOf(created.id)).map((row) => ({ outcome: row.outcome, broken: row.broken }))).toEqual([
          ...Array.from({ length: 5 }, () => ({ outcome: "recorded" as const, broken: true })),
          { outcome: "recorded", broken: false },
        ])
        yield* webhooks.update(t.actor, created.id, {
          parser: Schema.decodeUnknownSync(Webhook.Parser)({
            filter: 'body.event.event == "user signed up"',
            threadKey: "body.person.properties.email",
          }),
          mode: "live",
        })
        expect(yield* webhooks.replay(t.actor, { webhookId: created.id })).toEqual({ replayed: 6 })
        const accepted = yield* ChannelFixture.accepted(7)
        expect(accepted.filter((each) => each.webhook).map((each) => each.kind)).toEqual(
          Array.from({ length: 6 }, () => "start"),
        )
        const database = yield* Database.Service
        const titles = yield* database.db
          .select({ input: Database.Schema.agent_session.start_input })
          .from(Database.Schema.agent_session)
          .where(eq(Database.Schema.agent_session.space_id, t.spaceId))
        expect(
          titles
            .flatMap((row) => (row.input?.title?.startsWith("PostHog signups") ? [row.input.title] : []))
            .toSorted(),
        ).toEqual(Array.from({ length: 6 }, (_, index) => `PostHog signups · request ${index + 1}`))
        expect(yield* webhooks.replay(t.actor, { webhookId: created.id })).toEqual({ replayed: 0 })
      }),
  )

  it.live("a live webhook whose owner left the space switches to listening and keeps the request for a replay", () =>
    Effect.gen(function* () {
      const t = yield* owner
      const webhooks = yield* Webhooks.Service
      const database = yield* Database.Service
      const bob = yield* Seed.actor(t.organizationId, "member")
      yield* Seed.join(t.spaceId, bob.userId)
      const created = yield* webhooks.create(bob, decodeCreate({ spaceId: t.spaceId, name: "Signups", message: "Go." }))
      yield* webhooks.update(bob, created.id, { mode: "live" })
      yield* database.db
        .update(Database.Schema.space_member)
        .set({ archived_at: new Date() })
        .where(eq(Database.Schema.space_member.user_id, bob.userId))
      expect(yield* post(created.url, signup("ada@acme.com"))).toEqual({ status: 202 })
      const row = (yield* deliveriesOf(created.id)).at(0)
      yield* deliveriesOf(created.id).pipe(
        Effect.repeat({
          until: (rows) => rows.at(0)?.outcome === "recorded",
          schedule: Schedule.spaced("20 millis"),
        }),
        Effect.timeout("20 seconds"),
      )
      expect(yield* webhooks.get(t.actor, created.id)).toMatchObject({ mode: "listening", modeReason: "owner_left" })
      expect(yield* deliveriesOf(created.id)).toMatchObject([
        { id: row?.id, outcome: "recorded", reason: "the owner left the space" },
      ])
    }),
  )
})
