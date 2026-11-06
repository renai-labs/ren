export * as WebhookIntake from "./webhook-intake.js"

import { Database } from "@ren/db/database"
import { Drive } from "@ren/schema/drive"
import { Webhook } from "@ren/schema/webhook"
import { WebhookDelivery } from "@ren/schema/webhook-delivery"
import { and, count, desc, eq, gt, inArray, isNull } from "drizzle-orm"
import { Clock, Duration, Effect, Option, Redacted, Result, Schema } from "effect"
import { timingSafeEqual } from "node:crypto"
import { Access } from "./access.js"
import { AgentQueries } from "./agent/queries.js"
import { Drives } from "./drives.js"
import { Envelope } from "./envelope.js"
import type { Intake } from "./intake.js"
import { SpaceQueries } from "./space/queries.js"
import { WebhookParser } from "./webhook-parser.js"
import { WebhookSignature } from "./webhook-signature.js"
import { WebhookSecrets } from "./webhook/secrets.js"

export const Delivery = Schema.Struct({
  _tag: Schema.Literal("delivery"),
  webhookId: Webhook.ID,
  deliveryId: WebhookDelivery.ID,
  receivedAt: Schema.String,
  threadKey: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "WebhookIntake.Delivery" })
export type Delivery = typeof Delivery.Type

// oxlint-disable-next-line ren/no-comments -- W45: the repair chat of one version of a webhook, keyed by the time Ren switched it to listening.
export const Repair = Schema.Struct({
  _tag: Schema.Literal("repair"),
  webhookId: Webhook.ID,
  updatedAt: Schema.String,
}).annotate({ identifier: "WebhookIntake.Repair" })

export const Event = Schema.Union([Delivery, Repair]).annotate({ identifier: "WebhookIntake.Event" })
export type Event = typeof Event.Type

export class Skipped extends Schema.TaggedError<Skipped>()("WebhookIntake.Skipped", {
  reason: Schema.String,
  modeReason: Schema.optionalKey(Webhook.ModeReason),
}) {}

export interface Route extends Intake.Route {
  readonly webhook: {
    readonly id: Webhook.ID
    readonly name: string
    readonly message: string
    readonly parser: Webhook.Parser
  }
}

// oxlint-disable-next-line ren/no-comments -- W31: at most 60 requests in a minute for each webhook.
export const perMinute = 60

// oxlint-disable-next-line ren/no-comments -- W14: a body of 16 KB or less is in the message; a larger one is payload.json in the space drive.
export const inlineBytes = 16 * 1024

// oxlint-disable-next-line ren/no-comments -- W46: a run that fails tries again until an hour after the request arrived.
export const retryFor = Duration.hours(1)

const parsedOutcomes: ReadonlyArray<WebhookDelivery.Outcome> = [
  "ignored",
  "started",
  "continued",
  "duplicate",
  "failed",
]

const pathOf = /^\/webhooks\/([^/]+)\/([^/]+)$/u

const decodeParser = Schema.decodeUnknownSync(Webhook.Parser)

const same = (left: string, right: string) => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

const answer = (status: number): Intake.Received<Event> => ({ _tag: "Answer", status })

const answered = (value: WebhookParser.Answer): Intake.Received<Event> => ({ _tag: "Answer", ...value })

// oxlint-disable-next-line ren/no-comments -- Spec section 2.2 row 3: token, size, rate limit, handshake, signature, signed handshake, the delivery row, then the parser when live.
export const source = Effect.gen(function* () {
  const database = yield* Database.Service
  const envelope = yield* Envelope.Service
  const access = yield* Access.Service
  const drives = yield* Drives.Service
  const webhook = Database.Schema.webhook
  const delivery = Database.Schema.webhook_delivery

  const opened = (row: typeof webhook.$inferSelect, column: "token" | "signing_secret", sealed: typeof row.token) =>
    envelope.open(sealed, WebhookSecrets.contextOf(row, column)).pipe(Effect.orDie, Effect.map(Redacted.value))

  const record = (fields: Omit<typeof delivery.$inferInsert, "id">) =>
    database.db
      .insert(delivery)
      .values({ id: WebhookDelivery.ID.create(), ...fields })
      .onConflictDoNothing()
      .returning({ id: delivery.id, receivedAt: delivery.received_at })
      .pipe(Effect.orDie)

  type Row = typeof webhook.$inferSelect

  type Kept = Omit<typeof delivery.$inferInsert, "id" | "outcome">

  // oxlint-disable-next-line ren/no-comments -- Spec section 4: a wrong ID or token, or an archived webhook, is 404 with no row.
  const found = Effect.fnUntraced(function* (path: string) {
    const matched = pathOf.exec(path)
    const id = matched?.at(1) ?? ""
    if (!Schema.is(Webhook.ID)(id)) return Option.none<Row>()
    const row = (yield* database.db
      .select()
      .from(webhook)
      .where(and(eq(webhook.id, id), isNull(webhook.archived_at)))
      .pipe(Effect.orDie)).at(0)
    if (!row || !same(yield* opened(row, "token", row.token), matched?.at(2) ?? "")) return Option.none<Row>()
    return Option.some(row)
  })

  // oxlint-disable-next-line ren/no-comments -- W12 and W31: a body over 1 MB is rejected with headers only; over 60 requests a minute is throttled with its body.
  const limited = Effect.fnUntraced(function* (row: Row, base: Kept, request: Intake.Request) {
    if (
      Number(base.headers["content-length"] ?? 0) > Webhook.maximumBodyBytes ||
      Buffer.byteLength(request.body) > Webhook.maximumBodyBytes
    ) {
      yield* record({ ...base, outcome: "rejected", reason: "the body is larger than 1 MB" })
      return Option.some(answer(413))
    }
    const minuteAgo = new Date((yield* Clock.currentTimeMillis) - 60_000)
    const recent = (yield* database.db
      .select({ total: count() })
      .from(delivery)
      .where(and(eq(delivery.webhook_id, row.id), gt(delivery.received_at, minuteAgo)))
      .pipe(Effect.orDie)).at(0)?.total
    if ((recent ?? 0) < perMinute) return Option.none<Intake.Received<Event>>()
    yield* record({ ...base, body: request.body, outcome: "throttled", reason: "over 60 a minute" })
    return Option.some(answer(429))
  })

  // oxlint-disable-next-line ren/no-comments -- Spec section 3.1: `handshake` before the signature check, `signedHandshake` with sign() after it (W38).
  const handshaken = Effect.fnUntraced(function* (
    kept: Kept,
    result: Result.Result<Option.Option<WebhookParser.Answer>, string>,
  ) {
    if (Result.isFailure(result) || Option.isNone(result.success)) return Option.none<Intake.Received<Event>>()
    yield* record({ ...kept, outcome: "answered" })
    return Option.some(answered(result.success.value))
  })

  // oxlint-disable-next-line ren/no-comments -- Spec section 4: a wrong signature, or none while live, is rejected with headers only; while listening, an unsigned request is kept as unverified (W20).
  const signatureOf = Effect.fnUntraced(function* (row: Row, parser: Webhook.Parser, base: Kept, body: string) {
    const secret = row.signing_secret
      ? Option.some(yield* opened(row, "signing_secret", row.signing_secret))
      : Option.none<string>()
    const checked = WebhookSignature.verify(parser.signature, secret, { headers: base.headers, body }, Date.now())
    if (checked._tag === "Rejected" || (checked._tag === "Unsigned" && row.mode === "live")) {
      yield* record({
        ...base,
        outcome: "rejected",
        reason: checked._tag === "Rejected" ? checked.reason : "no signing secret",
      })
      return Result.fail(answer(401))
    }
    return Result.succeed({ secret, kept: { ...base, body, verified: checked._tag === "Verified" } })
  })

  // oxlint-disable-next-line ren/no-comments -- Spec section 7: Ren switches a live webhook to listening; the switch is a new version of it (W45). None when it was not live.
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

  // oxlint-disable-next-line ren/no-comments -- W21: 5 parsed deliveries in a row that are broken switch the webhook to listening; they become recorded, so a replay after the repair starts their chats (W23).
  const brokenRun = Effect.fnUntraced(function* (webhookId: Webhook.ID) {
    const recent = yield* database.db
      .select({ id: delivery.id, broken: delivery.broken })
      .from(delivery)
      .where(and(eq(delivery.webhook_id, webhookId), inArray(delivery.outcome, parsedOutcomes)))
      .orderBy(desc(delivery.received_at), desc(delivery.id))
      .limit(Webhook.brokenToListen)
      .pipe(Effect.orDie)
    if (recent.length < Webhook.brokenToListen || !recent.every((each) => each.broken)) return Option.none<Date>()
    const switched = yield* listen(webhookId, "parser_broken")
    if (Option.isSome(switched))
      yield* database.db
        .update(delivery)
        .set({ outcome: "recorded" })
        .where(
          inArray(
            delivery.id,
            recent.map((each) => each.id),
          ),
        )
        .pipe(Effect.orDie)
    return switched
  })

  // oxlint-disable-next-line ren/no-comments -- Spec section 3: a live delivery that passes the parser starts a run; a duplicate event ID is answered and dropped.
  const parsedRun = Effect.fnUntraced(function* (row: Row, kept: Kept, parsed: WebhookParser.Parsed) {
    if (parsed._tag === "Ignored") {
      yield* record({ ...kept, outcome: "ignored", broken: parsed.broken, reason: parsed.reason })
      if (!parsed.broken) return answer(200)
      return Option.match(yield* brokenRun(row.id), {
        onNone: () => answer(200),
        onSome: (updatedAt): Intake.Received<Event> => ({
          _tag: "Start",
          status: 200,
          event: { _tag: "repair", webhookId: row.id, updatedAt: updatedAt.toISOString() },
        }),
      })
    }
    const eventId = Option.getOrNull(parsed.eventId)
    const threadKey = Option.getOrUndefined(parsed.threadKey)
    const started = (yield* record({
      ...kept,
      outcome: "started",
      event_id: eventId,
      thread_key: threadKey ?? null,
    })).at(0)
    if (!started) {
      yield* record({
        ...kept,
        outcome: "duplicate",
        event_id: eventId,
        reason: "an earlier request had this event ID",
      })
      return answer(200)
    }
    const title = Option.getOrUndefined(parsed.title)
    return {
      _tag: "Start",
      status: 202,
      event: {
        _tag: "delivery",
        webhookId: row.id,
        deliveryId: started.id,
        receivedAt: started.receivedAt.toISOString(),
        ...(threadKey && { threadKey }),
        ...(title && { title }),
      },
    } satisfies Intake.Received<Event>
  })

  // oxlint-disable-next-line ren/no-comments -- Spec section 2.2 row 3: token, size, rate limit, handshake, signature, signed handshake, the delivery row, then the parser when live.
  const receive = Effect.fn("WebhookIntake.receive")(function* (request: Intake.Request) {
    const row = yield* found(request.path)
    if (Option.isNone(row)) return answer(404)
    const headers = Object.fromEntries(request.headers)
    const base: Kept = {
      webhook_id: row.value.id,
      method: request.method,
      query: request.query,
      headers,
      verified: false,
    }
    const limit = yield* limited(row.value, base, request)
    if (Option.isSome(limit)) return limit.value
    const parser = decodeParser(row.value.parser)
    const values = WebhookParser.valuesOf({ ...request, headers })
    const handshake = WebhookParser.handshake("handshake", parser.handshake, values)
    const early = yield* handshaken({ ...base, body: request.body }, handshake)
    if (Option.isSome(early)) return early.value
    if (request.method !== "POST") return answer(405)
    const signedIn = yield* signatureOf(row.value, parser, base, request.body)
    if (Result.isFailure(signedIn)) return signedIn.failure
    const secret = signedIn.success.secret
    const kept = signedIn.success.kept
    const signed = yield* handshaken(
      kept,
      Option.isSome(secret) && kept.verified
        ? WebhookParser.handshake("signedHandshake", parser.signedHandshake, values, (text) =>
            WebhookSignature.hmac(secret.value, text, "hex"),
          )
        : Result.succeed(Option.none()),
    )
    if (Option.isSome(signed)) return signed.value
    const broken = Result.isFailure(handshake) ? Option.some(handshake.failure) : Option.none<string>()
    if (row.value.mode === "listening") {
      yield* record({
        ...kept,
        outcome: "recorded",
        broken: Option.isSome(broken),
        reason: Option.getOrElse(broken, () => "listening"),
      })
      return answer(202)
    }
    return yield* parsedRun(
      row.value,
      kept,
      Option.match(broken, {
        onNone: () => WebhookParser.parsed(parser, values),
        onSome: (reason): WebhookParser.Parsed => ({ _tag: "Ignored", broken: true, reason }),
      }),
    )
  })

  const titleOf = (name: string, receivedAt: string) => `${name} · ${receivedAt.slice(0, 16).replace("T", " ")} UTC`

  const promptText = (message: string, row: typeof delivery.$inferSelect, hidden: ReadonlySet<string>, body: string) =>
    [
      message,
      "",
      "<webhook_request>",
      "headers:",
      ...Object.keys(row.headers)
        .filter((name) => !hidden.has(name))
        .map((name) => `  ${name}: ${row.headers[name]}`),
      "body:",
      body,
      "</webhook_request>",
    ].join("\n")

  const deliveryPrompt = Effect.fnUntraced(function* (event: Delivery, route: Route, ids: Intake.Ids) {
    const row = (yield* database.db
      .select()
      .from(delivery)
      .where(eq(delivery.id, event.deliveryId))
      .pipe(Effect.orDie)).at(0)
    if (!row) return yield* Effect.die(new Error(`The delivery ${event.deliveryId} has no row`))
    const body = row.body ?? ""
    const hidden = WebhookSignature.hidden(route.webhook.parser.signature)
    const origin = {
      webhookId: event.webhookId,
      name: route.webhook.name,
      deliveryId: event.deliveryId,
      receivedAt: event.receivedAt,
    }
    if (Buffer.byteLength(body) <= inlineBytes)
      return { prompt: { text: promptText(route.webhook.message, row, hidden, body) }, webhook: origin }
    const path = `${Drive.uploadsOf(ids.sessionId, ids.messageId)}/payload.json`
    const placed = yield* drives
      .put(
        { organizationId: route.organizationId, spaceId: route.spaceId },
        path,
        new TextEncoder().encode(body),
        "application/json",
      )
      .pipe(
        Effect.as(true),
        Effect.catchTag("Drives.Unavailable", (error) =>
          Effect.logWarning("A webhook body could not be put in the space’s drive", error).pipe(Effect.as(false)),
        ),
      )
    return {
      prompt: placed
        ? {
            text: promptText(route.webhook.message, row, hidden, `(${Buffer.byteLength(body)} bytes, in ${path})`),
            files: [{ path, name: "payload.json" }],
          }
        : { text: promptText(route.webhook.message, row, hidden, body) },
      webhook: origin,
    }
  })

  // oxlint-disable-next-line ren/no-comments -- Spec section 8: the repair chat gets the broken deliveries and the parser, and the steps to fix it.
  const repairPrompt = Effect.fnUntraced(function* (route: Route) {
    const broken = yield* database.db
      .select({ id: delivery.id, reason: delivery.reason })
      .from(delivery)
      .where(and(eq(delivery.webhook_id, route.webhook.id), eq(delivery.broken, true)))
      .orderBy(desc(delivery.received_at), desc(delivery.id))
      .limit(Webhook.brokenToListen)
      .pipe(Effect.orDie)
    return {
      prompt: {
        text: [
          `The parser of the webhook “${route.webhook.name}” (${route.webhook.id}) broke on ${Webhook.brokenToListen} requests in a row, so Ren switched it to listening. It records each request and starts no chat.`,
          "",
          "Broken requests:",
          ...broken.map((each) => `- ${each.id}: ${each.reason ?? "broken"}`),
          "",
          "Parser:",
          JSON.stringify(Schema.encodeSync(Webhook.Parser)(route.webhook.parser), null, 2),
          "",
          "Fix it: read the requests with webhook-delivery list, find a parser that works on them with webhook-delivery test, save it with webhook update and set mode live, then start the chats of the recorded requests with webhook-delivery replay.",
        ].join("\n"),
      },
    }
  })

  return {
    origin: "webhook",
    event: Event,
    delivery: "queue",
    receive,
    keyOf: (event: Event) =>
      event._tag === "repair"
        ? { scope: event.webhookId, eventId: `repair:${event.updatedAt}` }
        : {
            scope: event.webhookId,
            eventId: event.deliveryId,
            ...(event.threadKey && { threadKey: event.threadKey }),
          },
    deadlineOf: (event: Event) =>
      new Date(Date.parse(event._tag === "repair" ? event.updatedAt : event.receivedAt) + Duration.toMillis(retryFor)),
    resolve: Effect.fn("WebhookIntake.resolve")(function* (event: Event) {
      const row = (yield* database.db
        .select()
        .from(webhook)
        .where(eq(webhook.id, event.webhookId))
        .pipe(Effect.orDie)).at(0)
      if (!row || row.archived_at) return yield* new Skipped({ reason: "the webhook is archived" })
      const owner = yield* database
        .transaction((transaction) =>
          SpaceQueries.actsIn(transaction, access, row.organization_id, row.space_id, row.owner_id),
        )
        .pipe(Effect.orDie)
      if (!owner) return yield* new Skipped({ reason: "the owner left the space", modeReason: "owner_left" })
      const base = {
        organizationId: row.organization_id,
        spaceId: row.space_id,
        senderUserId: row.owner_id,
        takesThread: false,
        webhook: { id: row.id, name: row.name, message: row.message, parser: decodeParser(row.parser) },
      }
      // oxlint-disable-next-line ren/no-comments -- W35: the repair chat runs on the default agent of the space, which can change webhooks.
      if (event._tag === "repair")
        return { ...base, requiresAgent: false, title: `Repair: ${row.name}` } satisfies Route
      const agentId = row.agent_id
      if (agentId) {
        const usable = yield* database.db
          .select({ id: Database.Schema.agent.id })
          .from(Database.Schema.agent)
          .where(and(eq(Database.Schema.agent.id, agentId), AgentQueries.isUsableIn(row.space_id, row.organization_id)))
          .pipe(Effect.orDie)
        if (usable.length === 0)
          return yield* new Skipped({ reason: "the agent left the space", modeReason: "agent_removed" })
      }
      return {
        ...base,
        ...(agentId && { agentId }),
        requiresAgent: true,
        title: event.title ?? titleOf(row.name, event.receivedAt),
      } satisfies Route
    }),
    promptOf: (event: Event, route: Route, ids: Intake.Ids) =>
      event._tag === "repair" ? repairPrompt(route) : deliveryPrompt(event, route, ids),
    report: Effect.fn("WebhookIntake.report")(function* (event: Event, outcome: Intake.Outcome<Route, Skipped>) {
      if (event._tag === "repair")
        return yield* Effect.logInfo(`The repair chat of ${event.webhookId}: ${outcome._tag}`)
      const update = (set: Partial<typeof delivery.$inferInsert>) =>
        database.db.update(delivery).set(set).where(eq(delivery.id, event.deliveryId)).pipe(Effect.orDie)
      if (outcome._tag === "skipped") {
        const modeReason = outcome.reason.modeReason
        // oxlint-disable-next-line ren/no-comments -- Spec section 7: a webhook whose owner or agent left the space switches to listening, and keeps the request for a replay.
        if (modeReason) yield* listen(event.webhookId, modeReason)
        return yield* update({ outcome: modeReason ? "recorded" : "failed", reason: outcome.reason.reason })
      }
      if (outcome._tag === "failed")
        return yield* update({ outcome: "failed", reason: outcome.message, session_id: outcome.sessionId ?? null })
      return yield* update({ outcome: outcome._tag, session_id: outcome.sessionId })
    }),
  } satisfies Intake.Source<Event, Route, Skipped>
})
