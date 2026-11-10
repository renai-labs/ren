export * as WebhookReceiver from "./receiver.js"

import { Database } from "@ren/db/database"
import type { Envelope as EnvelopeSchema } from "@ren/schema/envelope"
import { Webhook } from "@ren/schema/webhook"
import { and, count, desc, eq, gt, inArray, isNull } from "drizzle-orm"
import { Clock, Effect, Option, Record, Redacted, Schema } from "effect"
import { Envelope } from "../envelope.js"
import type { Intake } from "../intake.js"
import { WebhookSignature } from "../webhook-signature.js"
import { WebhookDecide } from "./decide.js"
import { WebhookEvent } from "./event.js"
import { WebhookSecrets } from "./secrets.js"
import { WebhookSource } from "./source.js"

export const perMinute = 60

const parsedOutcomes: ReadonlyArray<Webhook.RequestOutcome> = [
  "queued",
  "started",
  "continued",
  "failed",
  "ignored",
  "duplicate",
]

const answer = (status: number): Intake.Received<WebhookEvent.Event> => ({ _tag: "Answer", status })

const answered = (value: WebhookDecide.Answer): Intake.Received<WebhookEvent.Event> => ({ _tag: "Answer", ...value })

export const make = Effect.gen(function* () {
  const database = yield* Database.Service
  const envelope = yield* Envelope.Service
  const webhook = Database.Schema.webhook
  const request = Database.Schema.webhook_request
  const app = Database.Schema.app

  type Row = typeof webhook.$inferSelect

  type Kept = Omit<typeof request.$inferInsert, "id" | "outcome">

  const opened = (row: Row, column: "token" | "signing_secret", sealed: EnvelopeSchema.Sealed) =>
    envelope.open(sealed, WebhookSecrets.contextOf(row, column)).pipe(Effect.orDie, Effect.map(Redacted.value))

  const insert = (fields: Omit<typeof request.$inferInsert, "id">) =>
    database.db
      .insert(request)
      .values({ id: Webhook.RequestID.create(), ...fields })
      .onConflictDoNothing()
      .returning({ id: request.id })
      .pipe(
        Effect.orDie,
        Effect.map((rows) => Option.fromNullishOr(rows.at(0)?.id)),
      )

  const lookup = Effect.fnUntraced(function* (params: Intake.Request["params"]) {
    const id = params["id"] ?? ""
    if (!Schema.is(Webhook.ID)(id)) return Option.none()
    const found = (yield* database.db
      .select({
        webhook,
        app: {
          id: app.id,
          name: app.name,
          webhooks: app.webhooks,
          archived_at: app.archived_at,
          updated_at: app.updated_at,
        },
      })
      .from(webhook)
      .leftJoin(app, eq(app.id, webhook.app_id))
      .where(and(eq(webhook.id, id), isNull(webhook.archived_at)))
      .pipe(Effect.orDie)).at(0)
    if (
      !found ||
      !WebhookSignature.same(yield* opened(found.webhook, "token", found.webhook.token), params["token"] ?? "")
    )
      return Option.none()
    return Option.some(found)
  })

  const listen = (webhookId: Webhook.ID, reason: Webhook.ModeReason) =>
    database.db
      .update(webhook)
      .set({ mode: "listening", mode_reason: reason, updated_at: new Date() })
      .where(and(eq(webhook.id, webhookId), eq(webhook.mode, "live")))
      .returning({ updatedAt: webhook.updated_at })
      .pipe(
        Effect.orDie,
        Effect.map((rows) => Option.fromNullishOr(rows.at(0)?.updatedAt)),
      )

  const brokenRun = Effect.fnUntraced(function* (row: Row) {
    const recent = yield* database.db
      .select({ id: request.id, broken: request.broken })
      .from(request)
      .where(and(eq(request.webhook_id, row.id), inArray(request.outcome, parsedOutcomes)))
      .orderBy(desc(request.received_at), desc(request.id))
      .limit(Webhook.brokenToListen)
      .pipe(Effect.orDie)
    if (recent.length < Webhook.brokenToListen || !recent.every((each) => each.broken)) return Option.none<Date>()
    const switched = yield* listen(row.id, "parser_broken")
    if (Option.isSome(switched))
      yield* database.db
        .update(request)
        .set({ outcome: "recorded" })
        .where(
          inArray(
            request.id,
            recent.map((each) => each.id),
          ),
        )
        .pipe(Effect.orDie)
    return row.app_id ? Option.none<Date>() : switched
  })

  const limited = Effect.fnUntraced(function* (row: Row, kept: Kept, body: string) {
    const minuteAgo = new Date((yield* Clock.currentTimeMillis) - 60_000)
    const counted = yield* database.db
      .select({ outcome: request.outcome, total: count() })
      .from(request)
      .where(and(eq(request.webhook_id, row.id), gt(request.received_at, minuteAgo)))
      .groupBy(request.outcome)
      .pipe(Effect.orDie)
    if (counted.reduce((sum, each) => sum + each.total, 0) < perMinute) return false
    if ((counted.find((each) => each.outcome === "throttled")?.total ?? 0) < perMinute)
      yield* insert({ ...kept, body, outcome: "throttled", reason: "over 60 a minute" })
    return true
  })

  const passed = Effect.fnUntraced(function* (
    row: Row,
    kept: Kept,
    decision: Extract<WebhookDecide.Decision, { readonly _tag: "Passed" }>,
  ) {
    const queued = yield* insert({
      ...kept,
      outcome: "queued",
      event_id: decision.eventId ?? null,
      thread_key: decision.threadKey ?? null,
    })
    if (Option.isNone(queued)) {
      yield* insert({
        ...kept,
        outcome: "duplicate",
        event_id: decision.eventId ?? null,
        reason: "an earlier request had this event ID",
      })
      return answer(200)
    }
    return {
      _tag: "Start",
      status: 202,
      event: {
        _tag: "request",
        webhookId: row.id,
        requestId: queued.value,
        replays: 0,
        ...(decision.threadKey && { threadKey: decision.threadKey }),
        ...(decision.title && { title: decision.title }),
      },
      undo: database.db.delete(request).where(eq(request.id, queued.value)).pipe(Effect.orDie, Effect.asVoid),
    } satisfies Intake.Received<WebhookEvent.Event>
  })

  const ignored = Effect.fnUntraced(function* (
    row: Row,
    kept: Kept,
    decision: Extract<WebhookDecide.Decision, { readonly _tag: "Ignored" }>,
  ) {
    yield* insert({ ...kept, outcome: "ignored", broken: decision.broken, reason: decision.reason })
    if (!decision.broken) return answer(200)
    return Option.match(yield* brokenRun(row), {
      onNone: () => answer(200),
      onSome: (updatedAt): Intake.Received<WebhookEvent.Event> => ({
        _tag: "Start",
        status: 200,
        event: { _tag: "repair", webhookId: row.id, updatedAt: updatedAt.toISOString() },
      }),
    })
  })

  const unsigned = Effect.fnUntraced(function* (
    row: Row,
    parser: Webhook.Parser | null,
    kept: Kept,
    incoming: Intake.Request,
    plain: WebhookDecide.Request,
  ) {
    if (incoming.bodyTooLarge) {
      yield* insert({ ...kept, outcome: "rejected", reason: "the body is larger than 1 MB" })
      return Option.some(answer(413))
    }
    if (yield* limited(row, kept, plain.body)) return Option.some(answer(429))
    const early = parser ? WebhookDecide.handshake(parser, plain) : Option.none()
    if (Option.isSome(early)) {
      yield* insert({ ...kept, body: plain.body, outcome: "answered" })
      return Option.some(answered(early.value))
    }
    if (incoming.method !== "POST") return Option.some(answer(405))
    if (parser) return Option.none<Intake.Received<WebhookEvent.Event>>()
    yield* listen(row.id, "preset_removed")
    yield* insert({ ...kept, body: plain.body, outcome: "recorded", reason: "the app no longer has this preset" })
    return Option.some(answer(202))
  })

  const signed = Effect.fnUntraced(function* (
    row: Row,
    parser: Webhook.Parser,
    kept: Kept,
    plain: WebhookDecide.Request,
  ) {
    const secret = row.signing_secret
      ? Option.some(yield* opened(row, "signing_secret", row.signing_secret))
      : Option.none<string>()
    const checked = yield* WebhookSignature.verify(
      parser.signature,
      secret,
      { headers: plain.headers, body: plain.body },
      yield* Clock.currentTimeMillis,
    )
    if (checked._tag === "Rejected" || (checked._tag === "Unsigned" && row.mode === "live")) {
      yield* insert({
        ...kept,
        outcome: "rejected",
        reason: checked._tag === "Rejected" ? checked.reason : "no signing secret",
      })
      return answer(401)
    }
    const verified = { ...kept, body: plain.body, verified: checked._tag === "Verified" }
    const decision = WebhookDecide.decide(parser, plain, { verified: verified.verified, secret })
    if (decision._tag === "Answered") {
      yield* insert({ ...verified, outcome: "answered" })
      return answered(decision.answer)
    }
    if (row.mode === "listening") {
      yield* insert({ ...verified, outcome: "recorded", reason: "listening" })
      return answer(202)
    }
    if (decision._tag === "Ignored") return yield* ignored(row, verified, decision)
    return yield* passed(row, verified, decision)
  })

  const receive = Effect.fn("WebhookReceiver.receive")(function* (incoming: Intake.Request) {
    const found = yield* lookup(incoming.params)
    if (Option.isNone(found)) return answer(404)
    const row = found.value.webhook
    const parser = WebhookSource.current(yield* WebhookSource.of(row), Option.fromNullishOr(found.value.app)).parser
    const headers = Object.fromEntries(incoming.headers)
    const hidden = WebhookSignature.hidden(parser?.signature ?? { kind: "none" })
    const kept: Kept = {
      webhook_id: row.id,
      method: incoming.method,
      query: incoming.query,
      headers: Record.map(headers, (value, name) => (hidden.has(name) ? "[hidden]" : value)),
      verified: false,
    }
    const body = incoming.body
    const plain = { method: incoming.method, query: incoming.query, headers, body }
    const early = yield* unsigned(row, parser, kept, incoming, plain)
    if (Option.isSome(early)) return early.value
    if (!parser) return answer(202)
    return yield* signed(row, parser, kept, plain)
  })

  return {
    origin: "webhook",
    event: WebhookEvent.Event,
    receive,
    keyOf: WebhookEvent.keyOf,
  } satisfies Intake.Receiver<WebhookEvent.Event>
})
