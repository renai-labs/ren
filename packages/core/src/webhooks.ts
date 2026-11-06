export * as Webhooks from "./webhooks.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Envelope as EnvelopeSchema } from "@ren/schema/envelope"
import type { Space } from "@ren/schema/space"
import { Webhook } from "@ren/schema/webhook"
import { WebhookDelivery } from "@ren/schema/webhook-delivery"
import { and, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import { Config, Context, DateTime, Effect, Layer, Option, Redacted, Result, Schema } from "effect"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { AgentQueries } from "./agent/queries.js"
import { Envelope } from "./envelope.js"
import { Intake } from "./intake.js"
import { IntakeThreads } from "./intake-threads.js"
import { Primitive } from "./primitive.js"
import { SpaceQueries } from "./space/queries.js"
import { WebhookParser } from "./webhook-parser.js"
import { WebhookSignature } from "./webhook-signature.js"
import { WebhookIntake } from "./webhook-intake.js"
import { WebhookPolicy } from "./webhook/policy.js"
import { WebhookSecrets } from "./webhook/secrets.js"

export type Interface = Primitive.Interface<typeof Webhook.definition> & {
  readonly deliveries: Primitive.Interface<typeof WebhookDelivery.definition>["list"]
  readonly test: (
    actor: Actor.Info,
    input: WebhookDelivery.TestInput,
  ) => Effect.Effect<WebhookDelivery.TestResult, Primitive.NotFound>
  readonly replay: (
    actor: Actor.Info,
    input: WebhookDelivery.ReplayInput,
  ) => Effect.Effect<WebhookDelivery.Replayed, Primitive.NotFound | Primitive.Forbidden | Primitive.Conflict>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Webhooks") {}

const webhook = Database.Schema.webhook

const delivery = Database.Schema.webhook_delivery

// oxlint-disable-next-line ren/no-comments -- The ux spec's "Test on the last 20 requests".
export const testedByDefault = 20

type Row = typeof webhook.$inferSelect

const notFound = new Primitive.NotFound({ message: "Webhook not found." })

const isID = Schema.is(Webhook.ID)

const decodeParser = Schema.decodeUnknownSync(Webhook.Parser)

const encodeParser = Schema.encodeSync(Webhook.Parser)

const actions = {
  get: Primitive.action(Webhook.definition, "get"),
  create: Primitive.action(Webhook.definition, "create"),
  update: Primitive.action(Webhook.definition, "update"),
  archive: Primitive.action(Webhook.definition, "archive"),
  rotateUrl: Primitive.action(Webhook.definition, "rotateUrl"),
  setSigningSecret: Primitive.action(Webhook.definition, "setSigningSecret"),
  revealSigningSecret: Primitive.action(Webhook.definition, "revealSigningSecret"),
  deliveries: Primitive.action(WebhookDelivery.definition, "list"),
}

const toDelivery = (row: typeof delivery.$inferSelect): WebhookDelivery.Info => ({
  id: row.id,
  webhookId: row.webhook_id,
  receivedAt: DateTime.fromDateUnsafe(row.received_at),
  outcome: row.outcome,
  broken: row.broken,
  reason: row.reason,
  verified: row.verified,
  eventId: row.event_id,
  threadKey: row.thread_key,
  sessionId: row.session_id,
  method: row.method,
  query: row.query,
  headers: row.headers,
  body: row.body,
})

const base64url = Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)

// oxlint-disable-next-line ren/no-comments -- 32 random bytes: the URL token (W17) and a secret that Ren makes (W18).
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)))

// oxlint-disable-next-line ren/no-comments -- W20: a webhook whose signature checks the sender goes live only with a signing secret.
export const needsSecret = (parser: Webhook.Parser) => parser.signature.kind !== "none"

const membershipOf = (actor: Actor.Info) =>
  and(
    eq(WebhookPolicy.membership.space_id, webhook.space_id),
    eq(WebhookPolicy.membership.user_id, actor.userId),
    isNull(WebhookPolicy.membership.archived_at),
    Actor.fenced(actor, WebhookPolicy.membership.space_id),
  )

// oxlint-disable-next-line ren/no-comments -- W10: a change to the message, the parser or the agent, or a switch to live after owner_left, makes the actor the owner.
const ownerAfter = (row: Row, input: Webhook.UpdateInput, actor: Actor.Info) => {
  const isWritten = [input.message, input.parser, input.agentId].some(
    // ast-grep-ignore: no-nullish-comparison, -- a null agent is a change: it clears the agent
    (value) => value !== undefined,
  )
  const goesLive = input.mode === "live" && row.mode !== "live"
  return isWritten || (goesLive && row.mode_reason === "owner_left") ? actor.userId : row.owner_id
}

// oxlint-disable-next-line ren/no-comments -- Whether a handshake answers a stored request: `handshake`, then `signedHandshake` with sign() for a verified request (W38).
const handshakeOf = (
  parser: Webhook.Parser,
  values: WebhookParser.Values,
  secret: Option.Option<string>,
): Result.Result<boolean, string> => {
  const plain = WebhookParser.handshake("handshake", parser.handshake, values)
  if (Result.isFailure(plain) || Option.isSome(plain.success)) return Result.map(plain, Option.isSome)
  if (Option.isNone(secret)) return Result.succeed(false)
  return Result.map(
    WebhookParser.handshake("signedHandshake", parser.signedHandshake, values, (text) =>
      WebhookSignature.hmac(secret.value, text, "hex"),
    ),
    Option.isSome,
  )
}

const invalid = (message: string, field: string) => new Primitive.Invalid({ message, field })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const envelope = yield* Envelope.Service
    const threads = yield* IntakeThreads.Service
    const intake = yield* Intake.Service
    const base = (yield* Config.String("REN_URL").pipe(Config.withDefault("http://localhost:4000"))).replace(/\/$/u, "")

    const open = (row: Row, column: "token" | "signing_secret", sealed: EnvelopeSchema.Sealed) =>
      envelope.open(sealed, WebhookSecrets.contextOf(row, column)).pipe(Effect.orDie)

    const seal = (row: Pick<Row, "id" | "organization_id">, column: "token" | "signing_secret", value: string) =>
      envelope.seal(Redacted.make(value), WebhookSecrets.contextOf(row, column)).pipe(Effect.orDie)

    const toInfo = Effect.fnUntraced(function* (row: Row) {
      const token = yield* open(row, "token", row.token)
      return {
        id: row.id,
        spaceId: row.space_id,
        slug: row.slug,
        name: row.name,
        url: `${base}/webhooks/${row.id}/${Redacted.value(token)}`,
        ownerId: row.owner_id,
        agentId: row.agent_id,
        mode: row.mode,
        modeReason: row.mode_reason,
        message: row.message,
        parser: decodeParser(row.parser),
        hasSigningSecret: Boolean(row.signing_secret),
        createdAt: DateTime.fromDateUnsafe(row.created_at),
        updatedAt: DateTime.fromDateUnsafe(row.updated_at),
        archivedAt: row.archived_at && DateTime.fromDateUnsafe(row.archived_at),
      } satisfies Webhook.Info
    })

    const written = (rows: ReadonlyArray<Row>) => {
      const row = rows.at(0)
      return row ? toInfo(row) : Effect.fail(notFound)
    }

    const visibleTo = (actor: Actor.Info) =>
      and(
        eq(webhook.organization_id, actor.organizationId),
        isNull(webhook.archived_at),
        Access.where(access.plan(actor, actions.get), WebhookPolicy.where),
      )

    const find = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      id: Webhook.ID,
      action: string,
    ) {
      const found = (yield* transaction
        .select({ webhook, membershipId: WebhookPolicy.membership.id })
        .from(webhook)
        .leftJoin(WebhookPolicy.membership, membershipOf(actor))
        .where(and(eq(webhook.id, id), visibleTo(actor)))
        .for("update", { of: webhook })).at(0)
      if (!found) return yield* notFound
      if (!access.isAllowed({ actor, action, resource: WebhookPolicy.resource(found.membershipId) }))
        return yield* new Primitive.Forbidden({ message: "You cannot change this webhook." })
      return found.webhook
    })

    const agentUsable = Effect.fnUntraced(function* (
      transaction: Pick<Database.Transaction, "select">,
      placement: { readonly organizationId: Auth.OrganizationID; readonly spaceId: Space.ID },
      agentId: NonNullable<Row["agent_id"]>,
    ) {
      const found = yield* transaction
        .select({ id: Database.Schema.agent.id })
        .from(Database.Schema.agent)
        .where(
          and(
            eq(Database.Schema.agent.id, agentId),
            AgentQueries.isUsableIn(placement.spaceId, placement.organizationId),
          ),
        )
      return found.length > 0
    })

    const parserOf = (parser: Webhook.Parser) =>
      Option.match(WebhookParser.check(parser), {
        onNone: () => Effect.succeed(parser),
        onSome: (problem) => Effect.fail(invalid(`${problem.field}: ${problem.message}`, `parser.${problem.field}`)),
      })

    // oxlint-disable-next-line ren/no-comments -- Spec section 7: before a webhook goes live, its owner and its agent must be in the space, and a signature that needs a secret must have one.
    const liveProblem = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      row: Pick<Row, "organization_id" | "space_id" | "agent_id" | "signing_secret">,
      ownerId: Auth.UserID,
      parser: Webhook.Parser,
    ) {
      if (needsSecret(parser) && !row.signing_secret)
        return Option.some("Set the signing secret before the webhook goes live.")
      if (!(yield* SpaceQueries.actsIn(transaction, access, row.organization_id, row.space_id, ownerId)))
        return Option.some("The owner is not in the space.")
      if (
        row.agent_id &&
        !(yield* agentUsable(transaction, { organizationId: row.organization_id, spaceId: row.space_id }, row.agent_id))
      )
        return Option.some("Pick an agent of the space first.")
      return Option.none<string>()
    })

    const change = (
      name: string,
      action: string,
      write: (transaction: Database.Transaction, row: Row) => Effect.Effect<ReadonlyArray<Row>, unknown>,
    ) =>
      Effect.fn(name)(function* (actor: Actor.Info, id: Webhook.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* find(transaction, actor, id, action)
            return yield* written(yield* write(transaction, row).pipe(Effect.orDie))
          }),
        )
      })

    const secretOf = Effect.fnUntraced(function* (row: Row) {
      if (!row.signing_secret) return yield* new Primitive.Conflict({ message: "The webhook has no signing secret." })
      return Redacted.value(yield* open(row, "signing_secret", row.signing_secret))
    })

    const readable = Effect.fnUntraced(function* (actor: Actor.Info, id: Webhook.ID) {
      const found = (yield* database.db
        .select({ webhook, membershipId: WebhookPolicy.membership.id })
        .from(webhook)
        .leftJoin(WebhookPolicy.membership, membershipOf(actor))
        .where(and(eq(webhook.id, id), visibleTo(actor)))
        .pipe(Effect.orDie)).at(0)
      if (
        !found ||
        !access.isAllowed({ actor, action: actions.deliveries, resource: WebhookPolicy.resource(found.membershipId) })
      )
        return yield* notFound
      return found.webhook
    })

    // oxlint-disable-next-line ren/no-comments -- What the parser would do with a stored request now, in the order of receive (spec section 3). It saves nothing.
    const tested = Effect.fnUntraced(function* (
      row: Row,
      parser: Webhook.Parser,
      secret: Option.Option<string>,
      found: typeof delivery.$inferSelect,
    ) {
      const result = (
        outcome: WebhookDelivery.Tested["outcome"],
        fields: Partial<Omit<WebhookDelivery.Tested, "deliveryId" | "outcome">> = {},
      ): WebhookDelivery.Tested => ({
        deliveryId: found.id,
        outcome,
        broken: false,
        reason: null,
        eventId: null,
        threadKey: null,
        title: null,
        ...fields,
      })
      if (found.outcome === "rejected") return result("rejected", { reason: found.reason })
      const values = WebhookParser.valuesOf({ ...found, body: found.body ?? "" })
      const handshaken = handshakeOf(parser, values, found.verified ? secret : Option.none())
      if (Result.isFailure(handshaken)) return result("ignored", { broken: true, reason: handshaken.failure })
      if (handshaken.success) return result("answered")
      const parsed = WebhookParser.parsed(parser, values)
      if (parsed._tag === "Ignored") return result("ignored", { broken: parsed.broken, reason: parsed.reason })
      const keys = {
        eventId: Option.getOrNull(parsed.eventId),
        threadKey: Option.getOrNull(parsed.threadKey),
        title: Option.getOrNull(parsed.title),
      }
      const earlier = keys.eventId
        ? yield* database.db
            .select({ id: delivery.id })
            .from(delivery)
            .where(
              and(
                eq(delivery.webhook_id, row.id),
                eq(delivery.event_id, keys.eventId),
                ne(delivery.id, found.id),
                inArray(delivery.outcome, ["started", "continued", "failed"]),
              ),
            )
            .pipe(Effect.orDie)
        : []
      if (earlier.length > 0) return result("duplicate", { ...keys, reason: "an earlier request had this event ID" })
      const chat = keys.threadKey ? yield* threads.open("webhook", row.id, keys.threadKey) : Option.none()
      return result(Option.isSome(chat) ? "continued" : "started", keys)
    })

    const updateDelivery = (id: WebhookDelivery.ID, set: Partial<typeof delivery.$inferInsert>) =>
      database.db.update(delivery).set(set).where(eq(delivery.id, id)).pipe(Effect.orDie)

    // oxlint-disable-next-line ren/no-comments -- One recorded request on replay. The signature is checked at the time the request arrived, so a timestamped one is not too old.
    const replayed = Effect.fnUntraced(function* (
      row: Row,
      parser: Webhook.Parser,
      secret: Option.Option<string>,
      found: typeof delivery.$inferSelect,
    ) {
      const body = found.body ?? ""
      const checked = WebhookSignature.verify(
        parser.signature,
        secret,
        { headers: found.headers, body },
        found.received_at.getTime(),
      )
      if (checked._tag === "Unsigned") return false
      if (checked._tag === "Rejected") {
        yield* updateDelivery(found.id, { outcome: "rejected", body: null, reason: checked.reason })
        return false
      }
      const parsed = WebhookParser.parsed(parser, WebhookParser.valuesOf({ ...found, body }))
      if (parsed._tag === "Ignored") {
        yield* updateDelivery(found.id, { outcome: "ignored", broken: parsed.broken, reason: parsed.reason })
        return false
      }
      const eventId = Option.getOrNull(parsed.eventId)
      const threadKey = Option.getOrUndefined(parsed.threadKey)
      const earlier = eventId
        ? yield* database.db
            .select({ id: delivery.id })
            .from(delivery)
            .where(
              and(
                eq(delivery.webhook_id, row.id),
                eq(delivery.event_id, eventId),
                ne(delivery.id, found.id),
                ne(delivery.outcome, "duplicate"),
              ),
            )
            .pipe(Effect.orDie)
        : []
      if (earlier.length > 0) {
        yield* updateDelivery(found.id, {
          outcome: "duplicate",
          event_id: eventId,
          reason: "an earlier request had this event ID",
        })
        return false
      }
      yield* updateDelivery(found.id, {
        outcome: "started",
        broken: false,
        reason: null,
        verified: true,
        event_id: eventId,
        thread_key: threadKey ?? null,
      })
      const title = Option.getOrUndefined(parsed.title)
      yield* intake.start(
        "webhook",
        Schema.encodeSync(WebhookIntake.Event)({
          _tag: "delivery",
          webhookId: row.id,
          deliveryId: found.id,
          receivedAt: found.received_at.toISOString(),
          ...(threadKey && { threadKey }),
          ...(title && { title }),
        }),
      )
      return true
    })

    return Service.of({
      list: Effect.fn("Webhooks.list")(function* (actor: Actor.Info, input: Webhook.ListInput) {
        const where = and(visibleTo(actor), input.spaceId ? eq(webhook.space_id, input.spaceId) : undefined)
        const found = yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              const rows = yield* transaction
                .select({ webhook })
                .from(webhook)
                .leftJoin(WebhookPolicy.membership, membershipOf(actor))
                .where(where)
                .orderBy(desc(webhook.created_at), desc(webhook.id))
                .limit(input.pageSize)
                .offset((input.page - 1) * input.pageSize)
              const totals = yield* transaction
                .select({ total: count() })
                .from(webhook)
                .leftJoin(WebhookPolicy.membership, membershipOf(actor))
                .where(where)
              return { rows, total: totals.at(0)?.total ?? 0 }
            }),
          )
          .pipe(Effect.orDie)
        return {
          items: yield* Effect.forEach(found.rows, (row) => toInfo(row.webhook)),
          page: input.page,
          pageSize: input.pageSize,
          total: found.total,
        }
      }),
      get: Effect.fn("Webhooks.get")(function* (actor: Actor.Info, idOrSlug: string) {
        if (!isID(idOrSlug)) return yield* notFound
        const found = (yield* database.db
          .select({ webhook })
          .from(webhook)
          .leftJoin(WebhookPolicy.membership, membershipOf(actor))
          .where(and(eq(webhook.id, idOrSlug), visibleTo(actor)))
          .pipe(Effect.orDie)).at(0)
        if (!found) return yield* notFound
        return yield* toInfo(found.webhook)
      }),
      create: Effect.fn("Webhooks.create")(function* (actor: Actor.Info, input: Webhook.CreateInput) {
        const parser = yield* parserOf(input.parser ?? decodeParser({}))
        // oxlint-disable-next-line ren/no-comments -- W3: a webhook created in a chat runs on the agent of that chat, unless the input names one.
        const agentId = input.agentId ?? (actor.agent?.spaceId === input.spaceId ? actor.agent.agentId : undefined)
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const space = (yield* transaction
              .select({ id: Database.Schema.space.id, membershipId: SpaceQueries.membership.id })
              .from(Database.Schema.space)
              .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
              .where(
                and(
                  eq(Database.Schema.space.id, input.spaceId),
                  eq(Database.Schema.space.organization_id, actor.organizationId),
                  isNull(Database.Schema.space.archived_at),
                ),
              )).at(0)
            if (!space?.membershipId) return yield* new Primitive.NotFound({ message: "Space not found." })
            if (
              !access.isAllowed({
                actor,
                action: actions.create,
                resource: WebhookPolicy.resource(space.membershipId),
              })
            )
              return yield* new Primitive.Forbidden({ message: "You cannot add webhooks to this space." })
            const placement = { organizationId: actor.organizationId, spaceId: input.spaceId }
            if (agentId && !(yield* agentUsable(transaction, placement, agentId)))
              return yield* new Primitive.NotFound({ message: "Agent not found." })
            const taken = yield* transaction
              .select({ slug: webhook.slug })
              .from(webhook)
              .where(and(eq(webhook.space_id, input.spaceId), isNull(webhook.archived_at)))
            const id = Webhook.ID.create()
            const rows = yield* transaction
              .insert(webhook)
              .values({
                id,
                organization_id: actor.organizationId,
                space_id: input.spaceId,
                slug: yield* Primitive.slugFor(input, "webhook", new Set(taken.map((row) => row.slug))),
                name: input.name,
                owner_id: actor.userId,
                agent_id: agentId ?? null,
                message: input.message,
                parser: encodeParser(parser),
                token: yield* seal({ id, organization_id: actor.organizationId }, "token", random()),
                created_by: actor.userId,
              })
              .returning()
            return yield* written(rows)
          }),
        )
      }),
      update: Effect.fn("Webhooks.update")(function* (actor: Actor.Info, id: Webhook.ID, input: Webhook.UpdateInput) {
        const parser = input.parser ? yield* parserOf(input.parser) : undefined
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* find(transaction, actor, id, actions.update)
            if (
              input.agentId &&
              !(yield* agentUsable(
                transaction,
                { organizationId: row.organization_id, spaceId: row.space_id },
                input.agentId,
              ))
            )
              return yield* new Primitive.NotFound({ message: "Agent not found." })
            const ownerId = ownerAfter(row, input, actor)
            // ast-grep-ignore: no-nullish-comparison, -- null clears the agent; undefined leaves it
            const next = { ...row, agent_id: input.agentId === undefined ? row.agent_id : input.agentId }
            if (input.mode === "live") {
              const problem = yield* liveProblem(transaction, next, ownerId, parser ?? decodeParser(row.parser))
              if (Option.isSome(problem)) return yield* invalid(problem.value, "mode")
            }
            const rows = yield* transaction
              .update(webhook)
              .set({
                name: input.name,
                message: input.message,
                agent_id: input.agentId,
                ...(parser && { parser: encodeParser(parser) }),
                ...(input.mode && { mode: input.mode, mode_reason: null }),
                owner_id: ownerId,
                updated_at: sql`now()`,
              })
              .where(eq(webhook.id, id))
              .returning()
            return yield* written(rows)
          }),
        )
      }),
      archive: change("Webhooks.archive", actions.archive, (transaction, row) =>
        transaction
          .update(webhook)
          .set({ archived_at: sql`now()`, updated_at: sql`now()` })
          .where(eq(webhook.id, row.id))
          .returning(),
      ),
      rotateUrl: change("Webhooks.rotateUrl", actions.rotateUrl, (transaction, row) =>
        Effect.gen(function* () {
          return yield* transaction
            .update(webhook)
            .set({ token: yield* seal(row, "token", random()), updated_at: sql`now()` })
            .where(eq(webhook.id, row.id))
            .returning()
        }),
      ),
      setSigningSecret: Effect.fn("Webhooks.setSigningSecret")(function* (
        actor: Actor.Info,
        id: Webhook.ID,
        input: Webhook.SigningSecretInput,
      ) {
        const secret = input.secret ?? random()
        const record = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* find(transaction, actor, id, actions.setSigningSecret)
            return yield* written(
              yield* transaction
                .update(webhook)
                .set({ signing_secret: yield* seal(row, "signing_secret", secret), updated_at: sql`now()` })
                .where(eq(webhook.id, row.id))
                .returning(),
            )
          }),
        )
        return { record, secret }
      }),
      deliveries: Effect.fn("Webhooks.deliveries")(function* (actor: Actor.Info, input: WebhookDelivery.ListInput) {
        const empty = { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
        if (Option.isNone(yield* Effect.option(readable(actor, input.webhookId)))) return empty
        const where = and(
          eq(delivery.webhook_id, input.webhookId),
          input.outcome ? eq(delivery.outcome, input.outcome) : undefined,
        )
        const rows = yield* database.db
          .select()
          .from(delivery)
          .where(where)
          .orderBy(desc(delivery.received_at), desc(delivery.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize)
          .pipe(Effect.orDie)
        const totals = yield* database.db.select({ total: count() }).from(delivery).where(where).pipe(Effect.orDie)
        return { ...empty, items: rows.map(toDelivery), total: totals.at(0)?.total ?? 0 }
      }),
      // oxlint-disable-next-line ren/no-comments -- W23: the current parser runs on each recorded or throttled request, oldest first, and Intake starts its chat. The key of its run is the delivery, so each starts at most one chat.
      replay: Effect.fn("Webhooks.replay")(function* (actor: Actor.Info, input: WebhookDelivery.ReplayInput) {
        const row = yield* database.transaction((transaction) =>
          find(transaction, actor, input.webhookId, actions.update),
        )
        if (row.mode !== "live") return yield* new Primitive.Conflict({ message: "Switch the webhook to live first." })
        const parser = decodeParser(row.parser)
        const secret = row.signing_secret
          ? Option.some(Redacted.value(yield* open(row, "signing_secret", row.signing_secret)))
          : Option.none<string>()
        const waiting = yield* database.db
          .select()
          .from(delivery)
          .where(and(eq(delivery.webhook_id, row.id), inArray(delivery.outcome, ["recorded", "throttled"])))
          .orderBy(delivery.received_at, delivery.id)
          .pipe(Effect.orDie)
        const started = yield* Effect.forEach(waiting, (found) => replayed(row, parser, secret, found))
        return { replayed: started.filter(Boolean).length }
      }),
      test: Effect.fn("Webhooks.test")(function* (actor: Actor.Info, input: WebhookDelivery.TestInput) {
        const row = yield* readable(actor, input.webhookId)
        const found = yield* database.db
          .select()
          .from(delivery)
          .where(
            and(
              eq(delivery.webhook_id, row.id),
              input.deliveryIds ? inArray(delivery.id, input.deliveryIds) : undefined,
            ),
          )
          .orderBy(desc(delivery.received_at), desc(delivery.id))
          .limit(input.deliveryIds?.length ?? testedByDefault)
          .pipe(Effect.orDie)
        const secret = row.signing_secret
          ? Option.some(Redacted.value(yield* open(row, "signing_secret", row.signing_secret)))
          : Option.none<string>()
        const parser = input.parser ?? decodeParser(row.parser)
        return { items: yield* Effect.forEach(found, (each) => tested(row, parser, secret, each)) }
      }),
      revealSigningSecret: Effect.fn("Webhooks.revealSigningSecret")(function* (actor: Actor.Info, id: Webhook.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* find(transaction, actor, id, actions.revealSigningSecret)
            return { record: yield* toInfo(row), secret: yield* secretOf(row) }
          }),
        )
      }),
    })
  }),
)
