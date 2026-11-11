export * as WebhookWorker from "./worker.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { Drive } from "@ren/schema/drive"
import { Webhook } from "@ren/schema/webhook"
import { and, count, desc, eq, sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { Access } from "../access.js"
import { AgentQueries } from "../agent/queries.js"
import { Drives } from "../drives.js"
import { Intake } from "../intake.js"
import { SpaceQueries } from "../space/queries.js"
import { WebhookEvent } from "./event.js"
import { WebhookSource } from "./source.js"

export class Skipped extends Schema.TaggedError<Skipped>()("WebhookWorker.Skipped", {
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

export const inlineBytes = 16 * 1024

const proxyHeaders = new Set([
  "forwarded",
  "via",
  "cdn-loop",
  "x-real-ip",
  "host",
  "connection",
  "content-length",
  "accept-encoding",
])

const proxyHeaderPrefixes = ["x-forwarded-", "x-amzn-", "cf-"]

const shown = (name: string, value: string) =>
  value !== "[hidden]" && !proxyHeaders.has(name) && !proxyHeaderPrefixes.some((prefix) => name.startsWith(prefix))

const escaped = (body: string) => body.replaceAll("</webhook_request", "<\\/webhook_request")

const promptText = (message: string, headers: Readonly<Record<string, string>>, body: string) =>
  [
    message,
    "",
    "<webhook_request>",
    "headers:",
    ...Object.keys(headers).flatMap((name) => {
      const value = headers[name] ?? ""
      return shown(name, value) ? [`  ${name}: ${value}`] : []
    }),
    "body:",
    body,
    "</webhook_request>",
  ].join("\n")

const encodeParser = Schema.encodeSync(Webhook.Parser)

export const make = Effect.gen(function* () {
  const database = yield* Database.Service
  const access = yield* Access.Service
  const drives = yield* Drives.Service
  const webhook = Database.Schema.webhook
  const request = Database.Schema.webhook_request
  const app = Database.Schema.app

  const actsIn = (row: typeof webhook.$inferSelect, userId: Auth.UserID) =>
    database
      .transaction((transaction) => SpaceQueries.actsIn(transaction, access, row.organization_id, row.space_id, userId))
      .pipe(Effect.orDie)

  const senderOf = Effect.fnUntraced(function* (row: typeof webhook.$inferSelect) {
    if (yield* actsIn(row, row.owner_id)) return Option.some(row.owner_id)
    const fallback = row.fallback_user_id
    if (fallback && (yield* actsIn(row, fallback))) return Option.some(fallback)
    return Option.none<Auth.UserID>()
  })

  const listen = (webhookId: Webhook.ID, reason: Webhook.ModeReason) =>
    database.db
      .update(webhook)
      .set({ mode: "listening", mode_reason: reason, updated_at: sql`now()` })
      .where(and(eq(webhook.id, webhookId), eq(webhook.mode, "live")))
      .pipe(Effect.orDie)

  const titleOf = Effect.fnUntraced(function* (name: string, event: WebhookEvent.Request) {
    const counted = yield* database.db
      .select({ total: count() })
      .from(request)
      .where(
        and(
          eq(request.webhook_id, event.webhookId),
          sql`${request.received_at} <= (select received_at from ${request} where id = ${event.requestId})`,
        ),
      )
      .pipe(Effect.orDie)
    return `${name} · request ${counted.at(0)?.total ?? 1}`
  })

  const requestPrompt = Effect.fnUntraced(function* (event: WebhookEvent.Request, route: Route, ids: Intake.Ids) {
    const row = (yield* database.db
      .select()
      .from(request)
      .where(eq(request.id, event.requestId))
      .pipe(Effect.orDie)).at(0)
    if (!row) return yield* Effect.die(new Error(`The request ${event.requestId} has no row`))
    const body = escaped(row.body ?? "")
    const webhookOrigin = {
      webhookId: event.webhookId,
      name: route.webhook.name,
      requestId: event.requestId,
      receivedAt: row.received_at.toISOString(),
    }
    const bytes = Buffer.byteLength(body)
    if (bytes <= inlineBytes)
      return { prompt: { text: promptText(route.webhook.message, row.headers, body) }, webhook: webhookOrigin }
    const path = `${Drive.uploadsOf(ids.sessionId, ids.messageId)}/payload.json`
    yield* drives
      .put(
        { organizationId: route.organizationId, spaceId: route.spaceId },
        path,
        new TextEncoder().encode(row.body ?? ""),
        "application/json",
      )
      .pipe(Effect.mapError((error) => new Intake.Unavailable({ message: error.message })))
    return {
      prompt: {
        text: promptText(route.webhook.message, row.headers, `(${bytes} bytes, in ${path})`),
        files: [{ path, name: "payload.json" }],
      },
      webhook: webhookOrigin,
    }
  })

  const repairPrompt = Effect.fnUntraced(function* (route: Route) {
    const broken = yield* database.db
      .select({ id: request.id, reason: request.reason })
      .from(request)
      .where(and(eq(request.webhook_id, route.webhook.id), eq(request.broken, true)))
      .orderBy(desc(request.received_at), desc(request.id))
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
          JSON.stringify(encodeParser(route.webhook.parser), null, 2),
          "",
          "Fix it: read the requests with webhook_request_list and webhook_request_get, find a parser that works on them with webhook_test, save it with webhook_update and set mode live, then start the chats of the recorded requests with webhook_replay.",
        ].join("\n"),
      },
    }
  })

  return {
    origin: "webhook",
    event: WebhookEvent.Event,
    delivery: "queue",
    resolve: Effect.fn("WebhookWorker.resolve")(function* (event: WebhookEvent.Event) {
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
        .where(eq(webhook.id, event.webhookId))
        .pipe(Effect.orDie)).at(0)
      if (!found || found.webhook.archived_at) return yield* new Skipped({ reason: "the webhook is archived" })
      const row = found.webhook
      const current = WebhookSource.current(yield* WebhookSource.of(row), Option.fromNullishOr(found.app))
      if (!current.parser || !current.message)
        return yield* new Skipped({ reason: "the app no longer has this preset", modeReason: "preset_removed" })
      const sender = yield* senderOf(row)
      if (Option.isNone(sender))
        return yield* new Skipped({ reason: "the owner left the space", modeReason: "owner_left" })
      const base = {
        organizationId: row.organization_id,
        spaceId: row.space_id,
        senderUserId: sender.value,
        chat: { _tag: "Thread" },
        webhook: { id: row.id, name: current.name, message: current.message, parser: current.parser },
      } as const
      if (event._tag === "repair") return { ...base, title: `Repair: ${current.name}` } satisfies Route
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
        title: event.title ?? (yield* titleOf(current.name, event)),
      } satisfies Route
    }),
    promptOf: (event: WebhookEvent.Event, route: Route, ids: Intake.Ids) =>
      event._tag === "repair" ? repairPrompt(route) : requestPrompt(event, route, ids),
    report: Effect.fn("WebhookWorker.report")(function* (
      event: WebhookEvent.Event,
      outcome: Intake.Outcome<Route, Skipped>,
    ) {
      if (event._tag === "repair")
        return yield* Effect.logInfo(`The repair chat of ${event.webhookId}: ${outcome._tag}`)
      const update = (set: Partial<typeof request.$inferInsert>) =>
        database.db.update(request).set(set).where(eq(request.id, event.requestId)).pipe(Effect.orDie)
      if (outcome._tag === "skipped") {
        const modeReason = outcome.reason.modeReason
        if (modeReason) yield* listen(event.webhookId, modeReason)
        return yield* update({ outcome: modeReason ? "recorded" : "failed", reason: outcome.reason.reason })
      }
      if (outcome._tag === "failed")
        return yield* update({ outcome: "failed", reason: outcome.message, session_id: outcome.sessionId ?? null })
      return yield* update({ outcome: outcome._tag, session_id: outcome.sessionId })
    }),
  } satisfies Intake.Worker<WebhookEvent.Event, Route, Skipped>
})
