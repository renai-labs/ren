import { describe, expect, setDefaultTimeout } from "bun:test"
import { Database } from "@ren/db/database"
import { Session } from "@ren/schema/session"
import { Webhook } from "@ren/schema/webhook"
import { WebhookDelivery } from "@ren/schema/webhook-delivery"
import { asc, eq } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Schedule, Schema } from "effect"
import type { Actor } from "../src/actor.js"
import { Envelope } from "../src/envelope.js"
import { Intake } from "../src/intake.js"
import { IntakeThreads } from "../src/intake-threads.js"
import { WebhookIntake } from "../src/webhook-intake.js"
import { WebhookSignature } from "../src/webhook-signature.js"
import { Webhooks } from "../src/webhooks.js"
import { ChannelFixture } from "./lib/channel-fixture.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(60_000)

const it = testEffect(
  Webhooks.layer.pipe(
    Layer.provide(Layer.mergeAll(Envelope.layerLocal, IntakeThreads.layer)),
    Layer.provideMerge(
      ChannelFixture.intakeLayer(
        Intake.sources(Effect.all([WebhookIntake.source])).pipe(Layer.provide(Envelope.layerLocal)),
      ),
    ),
    Layer.provide(
      ConfigProvider.layerAdd(
        ConfigProvider.fromUnknown({
          REN_URL: "https://ren.test",
          ENVELOPE_KEYS: JSON.stringify([
            { id: "local:test", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
          ]),
        }),
      ),
    ),
  ),
)

const decodeCreate = Schema.decodeUnknownSync(Webhook.CreateInput)

const owner = Effect.gen(function* () {
  const seeded = yield* Seed.owner()
  const actor: Actor.Info = { userId: seeded.createdBy, organizationId: seeded.organizationId, roles: ["owner"] }
  return { ...seeded, actor }
})

const post = (
  url: string,
  body: string,
  headers: Record<string, string> = {},
  method = "POST",
): Effect.Effect<Intake.Reply, never, Intake.Service> =>
  Effect.flatMap(Intake.Service, (intake) => {
    const parsed = new URL(url)
    return intake.receive("webhook", {
      method,
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams),
      headers: new Headers({ "content-type": "application/json", ...headers }),
      body,
    })
  })

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
        expect(yield* post(created.url, first)).toEqual({ status: 202 })
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
})
