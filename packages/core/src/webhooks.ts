export * as Webhooks from "./webhooks.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Envelope as EnvelopeSchema } from "@ren/schema/envelope"
import type { Space } from "@ren/schema/space"
import { Webhook } from "@ren/schema/webhook"
import { WebhookRequest } from "@ren/schema/webhook-request"
import { and, count, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import { Config, Context, DateTime, Effect, Layer, Option, Redacted, Schema } from "effect"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { AgentQueries } from "./agent/queries.js"
import { AppProfiles } from "./app/profiles.js"
import { Envelope } from "./envelope.js"
import { Intake } from "./intake.js"
import { Primitive } from "./primitive.js"
import { SpaceQueries } from "./space/queries.js"
import { WebhookDecide } from "./webhook/decide.js"
import { WebhookEvent } from "./webhook/event.js"
import { WebhookPolicy } from "./webhook/policy.js"
import { WebhookSecrets } from "./webhook/secrets.js"
import { WebhookSource } from "./webhook/source.js"

export type Interface = Primitive.Interface<typeof Webhook.definition> & {
  readonly requests: Primitive.Interface<typeof WebhookRequest.definition>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Webhooks") {}

const webhook = Database.Schema.webhook

const request = Database.Schema.webhook_request

const app = Database.Schema.app

type Row = typeof webhook.$inferSelect

const appColumns = {
  id: app.id,
  name: app.name,
  webhooks: app.webhooks,
  archived_at: app.archived_at,
  updated_at: app.updated_at,
}

const notFound = new Primitive.NotFound({ message: "Webhook not found." })

const isID = Schema.is(Webhook.ID)

const encodeParser = Schema.encodeSync(Webhook.Parser)

const actions = {
  get: Primitive.action(Webhook.definition, "get"),
  create: Primitive.action(Webhook.definition, "create"),
  update: Primitive.action(Webhook.definition, "update"),
  archive: Primitive.action(Webhook.definition, "archive"),
  rotateUrl: Primitive.action(Webhook.definition, "rotateUrl"),
  setSigningSecret: Primitive.action(Webhook.definition, "setSigningSecret"),
  revealSigningSecret: Primitive.action(Webhook.definition, "revealSigningSecret"),
  test: Primitive.action(Webhook.definition, "test"),
  replay: Primitive.action(Webhook.definition, "replay"),
  requests: Primitive.action(WebhookRequest.definition, "list"),
  request: Primitive.action(WebhookRequest.definition, "get"),
}

const base64url = Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)

const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)))

export const needsSecret = (parser: Webhook.Parser) => parser.signature.kind !== "none"

const membershipOf = (actor: Actor.Info) =>
  and(
    eq(WebhookPolicy.membership.space_id, webhook.space_id),
    eq(WebhookPolicy.membership.user_id, actor.userId),
    isNull(WebhookPolicy.membership.archived_at),
    Actor.fenced(actor, WebhookPolicy.membership.space_id),
  )

const invalid = (message: string, field: string) => new Primitive.Invalid({ message, field })

const testedByDefault = 20

const replayBatch = 100

const waiting: ReadonlyArray<Webhook.RequestOutcome> = ["recorded", "throttled", "failed"]

const encodeEvent = Schema.encodeSync(WebhookEvent.Event)

const presetGone = new Primitive.Conflict({ message: "The app no longer has this preset." })

const decisionOf = (
  parser: Webhook.Parser,
  secret: Option.Option<string>,
  found: typeof request.$inferSelect,
): WebhookDecide.Decision =>
  needsSecret(parser) && !found.verified
    ? { _tag: "Ignored", broken: false, reason: "the request came before the signing secret" }
    : WebhookDecide.decide(
        parser,
        { method: found.method, query: found.query, headers: found.headers, body: found.body ?? "" },
        { verified: found.verified, secret },
      )

const ownerAfter = (row: Row, input: Webhook.UpdateInput, actor: Actor.Info) => {
  const isWritten = [input.message, input.parser, input.agentId].some(
    // ast-grep-ignore: no-nullish-comparison, -- a null agent is a change: it clears the agent
    (value) => value !== undefined,
  )
  const goesLive = input.mode === "live" && row.mode !== "live"
  return isWritten || (goesLive && row.mode_reason === "owner_left") ? actor.userId : row.owner_id
}

const columnsOf = (source: Webhook.Source) =>
  source._tag === "custom"
    ? { name: source.name, message: source.message, parser: encodeParser(source.parser) }
    : { app_id: source.appId, preset: source.preset }

const fixedOf = (source: Webhook.Source, input: Webhook.UpdateInput) =>
  source._tag === "preset"
    ? Option.fromNullishOr((["name", "message", "parser"] as const).find((field) => input[field]))
    : Option.none()

const bodyBytes = sql<number | null>`octet_length(${request.body})`

const requestColumns = {
  id: request.id,
  webhookId: request.webhook_id,
  receivedAt: request.received_at,
  outcome: request.outcome,
  broken: request.broken,
  reason: request.reason,
  verified: request.verified,
  eventId: request.event_id,
  threadKey: request.thread_key,
  sessionId: request.session_id,
  method: request.method,
  bodyBytes,
}

const requestInfo = <Found extends { readonly receivedAt: Date }>(row: Found) => ({
  ...row,
  receivedAt: DateTime.fromDateUnsafe(row.receivedAt),
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const envelope = yield* Envelope.Service
    const intake = yield* Intake.Service
    const base = (yield* Config.String("REN_URL").pipe(Config.withDefault("http://localhost:4000"))).replace(/\/$/u, "")

    const open = (row: Row, column: "token" | "signing_secret", sealed: EnvelopeSchema.Sealed) =>
      envelope.open(sealed, WebhookSecrets.contextOf(row, column)).pipe(Effect.orDie)

    const seal = (row: Pick<Row, "id" | "organization_id">, column: "token" | "signing_secret", value: string) =>
      envelope.seal(Redacted.make(value), WebhookSecrets.contextOf(row, column)).pipe(Effect.orDie)

    const lastRequests = (client: Pick<Database.Transaction, "selectDistinctOn">, ids: ReadonlyArray<Webhook.ID>) =>
      ids.length === 0
        ? Effect.succeed(new Map<Webhook.ID, Webhook.LastRequest>())
        : client
            .selectDistinctOn([request.webhook_id], {
              webhookId: request.webhook_id,
              id: request.id,
              receivedAt: request.received_at,
              outcome: request.outcome,
              broken: request.broken,
            })
            .from(request)
            .where(inArray(request.webhook_id, ids))
            .orderBy(request.webhook_id, desc(request.received_at), desc(request.id))
            .pipe(
              Effect.map(
                (rows) =>
                  new Map(
                    rows.map((row) => [
                      row.webhookId,
                      {
                        id: row.id,
                        receivedAt: DateTime.fromDateUnsafe(row.receivedAt),
                        outcome: row.outcome,
                        broken: row.broken,
                      },
                    ]),
                  ),
              ),
            )

    const toInfo = Effect.fnUntraced(function* (
      row: Row,
      found: WebhookSource.App | null,
      lastRequest: Webhook.LastRequest | undefined,
    ) {
      const token = yield* open(row, "token", row.token)
      const current = WebhookSource.current(yield* WebhookSource.of(row), Option.fromNullishOr(found))
      return {
        id: row.id,
        spaceId: row.space_id,
        slug: row.slug,
        name: current.name,
        url: `${base}/webhooks/${row.id}/${Redacted.value(token)}`,
        preset: current.preset,
        ownerId: row.owner_id,
        fallbackUserId: row.fallback_user_id,
        agentId: row.agent_id,
        mode: row.mode,
        modeReason: row.mode_reason,
        message: current.message,
        parser: current.parser,
        hasSigningSecret: Boolean(row.signing_secret),
        lastRequest: lastRequest ?? null,
        createdAt: DateTime.fromDateUnsafe(row.created_at),
        updatedAt: DateTime.fromDateUnsafe(row.updated_at),
        archivedAt: row.archived_at && DateTime.fromDateUnsafe(row.archived_at),
      } satisfies Webhook.Info
    })

    const infoOf = Effect.fnUntraced(function* (client: Database.Transaction, row: Row) {
      const found = row.app_id
        ? (yield* client.select(appColumns).from(app).where(eq(app.id, row.app_id))).at(0)
        : undefined
      const last = yield* lastRequests(client, [row.id])
      return yield* toInfo(row, found ?? null, last.get(row.id))
    })

    const written = (client: Database.Transaction, rows: ReadonlyArray<Row>) => {
      const row = rows.at(0)
      return row ? infoOf(client, row) : Effect.fail(notFound)
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

    const readable = Effect.fnUntraced(function* (actor: Actor.Info, id: Webhook.ID, action: string) {
      const found = (yield* database.db
        .select({ webhook, membershipId: WebhookPolicy.membership.id })
        .from(webhook)
        .leftJoin(WebhookPolicy.membership, membershipOf(actor))
        .where(and(eq(webhook.id, id), visibleTo(actor)))
        .pipe(Effect.orDie)).at(0)
      if (!found || !access.isAllowed({ actor, action, resource: WebhookPolicy.resource(found.membershipId) }))
        return yield* notFound
      return found.webhook
    })

    const agentOf = Effect.fnUntraced(function* (
      transaction: Pick<Database.Transaction, "select">,
      placement: { readonly organizationId: Auth.OrganizationID; readonly spaceId: Space.ID },
      agentId: NonNullable<Row["agent_id"]>,
    ) {
      return (yield* transaction
        .select({ name: Database.Schema.agent.name, organizationId: Database.Schema.agent.organization_id })
        .from(Database.Schema.agent)
        .where(
          and(
            eq(Database.Schema.agent.id, agentId),
            AgentQueries.isUsableIn(placement.spaceId, placement.organizationId),
          ),
        )).at(0)
    })

    const checkedAgent = Effect.fnUntraced(function* (
      transaction: Pick<Database.Transaction, "select">,
      placement: { readonly organizationId: Auth.OrganizationID; readonly spaceId: Space.ID },
      agentId: NonNullable<Row["agent_id"]>,
    ) {
      const found = yield* agentOf(transaction, placement, agentId)
      if (!found) return yield* new Primitive.NotFound({ message: "Agent not found in this space." })
      if (!found.organizationId)
        return yield* new Primitive.Invalid({
          message: `${found.name} is the space default. Leave the agent empty to use it.`,
        })
    })

    // oxlint-disable-next-line ren/no-comments -- An agent that creates a webhook without naming one passes on itself, unless it is a global agent: the space default runs then.
    const agentForCreate = Effect.fnUntraced(function* (
      transaction: Pick<Database.Transaction, "select">,
      placement: { readonly organizationId: Auth.OrganizationID; readonly spaceId: Space.ID },
      named: Row["agent_id"] | undefined,
      inherited: Row["agent_id"] | undefined,
    ) {
      if (named) {
        yield* checkedAgent(transaction, placement, named)
        return named
      }
      if (!inherited) return
      return (yield* agentOf(transaction, placement, inherited))?.organizationId ? inherited : undefined
    })

    const reachedPreset = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      placement: { readonly organizationId: Auth.OrganizationID; readonly spaceId: Space.ID },
      source: Extract<Webhook.Source, { readonly _tag: "preset" }>,
    ) {
      const reached = yield* AppProfiles.reachable(transaction, {
        organizationId: placement.organizationId,
        spaceId: Option.some(placement.spaceId),
      })
      const found = reached.some((profile) => profile.appId === source.appId)
        ? (yield* transaction
            .select(appColumns)
            .from(app)
            .where(and(eq(app.id, source.appId), isNull(app.archived_at)))).at(0)?.webhooks[source.preset]
        : undefined
      if (!found) return yield* new Primitive.NotFound({ message: "The space reaches no app with this preset." })
      return found
    })

    const currentOf = Effect.fnUntraced(function* (client: Database.Transaction, row: Row, source: Webhook.Source) {
      const found = row.app_id
        ? (yield* client.select(appColumns).from(app).where(eq(app.id, row.app_id))).at(0)
        : undefined
      return WebhookSource.current(source, Option.fromNullishOr(found))
    })

    const checked = (parser: Webhook.Parser) =>
      Option.match(WebhookDecide.check(parser), {
        onNone: () => Effect.succeed(parser),
        onSome: (problem) => Effect.fail(invalid(`${problem.field}: ${problem.message}`, `parser.${problem.field}`)),
      })

    const liveProblem = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      row: Pick<Row, "organization_id" | "space_id" | "agent_id" | "signing_secret">,
      ownerId: Auth.UserID,
      parser: Webhook.Parser | null,
    ) {
      if (!parser) return Option.some("The app no longer has this preset.")
      if (needsSecret(parser) && !row.signing_secret)
        return Option.some("Set the signing secret before the webhook goes live.")
      if (!(yield* SpaceQueries.actsIn(transaction, access, row.organization_id, row.space_id, ownerId)))
        return Option.some("The owner is not in the space.")
      if (
        row.agent_id &&
        !(yield* agentOf(transaction, { organizationId: row.organization_id, spaceId: row.space_id }, row.agent_id))
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
            return yield* written(transaction, yield* write(transaction, row).pipe(Effect.orDie))
          }),
        )
      })

    const secretOption = (row: Row) =>
      row.signing_secret
        ? Effect.map(open(row, "signing_secret", row.signing_secret), (value) => Option.some(Redacted.value(value)))
        : Effect.succeed(Option.none<string>())

    const earlier = (found: typeof request.$inferSelect, eventId: string | undefined) =>
      eventId
        ? database.db
            .select({ id: request.id })
            .from(request)
            .where(
              and(
                eq(request.webhook_id, found.webhook_id),
                eq(request.event_id, eventId),
                ne(request.id, found.id),
                ne(request.outcome, "duplicate"),
              ),
            )
            .limit(1)
            .pipe(
              Effect.orDie,
              Effect.map((rows) => rows.length > 0),
            )
        : Effect.succeed(false)

    const parserNow = Effect.fnUntraced(function* (row: Row) {
      const current = yield* database.transaction((transaction) =>
        Effect.gen(function* () {
          return yield* currentOf(transaction, row, yield* WebhookSource.of(row))
        }),
      )
      if (!current.parser) return yield* presetGone
      return current.parser
    })

    const tested = Effect.fnUntraced(function* (
      parser: Webhook.Parser,
      secret: Option.Option<string>,
      found: typeof request.$inferSelect,
    ) {
      const result = (
        outcome: Webhook.TestOutcome,
        fields: Partial<Omit<Webhook.Tested, "requestId" | "outcome">> = {},
      ): Webhook.Tested => ({
        requestId: found.id,
        outcome,
        broken: false,
        reason: null,
        eventId: null,
        threadKey: null,
        title: null,
        ...fields,
      })
      if (found.outcome === "rejected") return result("rejected", { reason: found.reason })
      const decision = decisionOf(parser, secret, found)
      if (decision._tag === "Answered") return result("answered")
      if (decision._tag === "Ignored")
        return result(decision.reason === "the request came before the signing secret" ? "rejected" : "ignored", {
          broken: decision.broken,
          reason: decision.reason,
        })
      const keys = {
        eventId: decision.eventId ?? null,
        threadKey: decision.threadKey ?? null,
        title: decision.title ?? null,
      }
      if (yield* earlier(found, decision.eventId))
        return result("duplicate", { ...keys, reason: "an earlier request had this event ID" })
      return result("passed", keys)
    })

    const updateRequest = (id: Webhook.RequestID, set: Partial<typeof request.$inferInsert>) =>
      database.db.update(request).set(set).where(eq(request.id, id)).pipe(Effect.orDie)

    const replayed = Effect.fnUntraced(function* (
      row: Row,
      parser: Webhook.Parser,
      secret: Option.Option<string>,
      found: typeof request.$inferSelect,
    ) {
      const decision = decisionOf(parser, secret, found)
      if (decision._tag === "Answered") {
        yield* updateRequest(found.id, { outcome: "answered" })
        return false
      }
      if (decision._tag === "Ignored") {
        const isUnverified = decision.reason === "the request came before the signing secret"
        yield* updateRequest(found.id, {
          outcome: isUnverified ? "rejected" : "ignored",
          broken: decision.broken,
          reason: decision.reason,
          ...(isUnverified && { body: null }),
        })
        return false
      }
      const start = (replays: number) =>
        intake.start(
          "webhook",
          encodeEvent({
            _tag: "request",
            webhookId: row.id,
            requestId: found.id,
            replays,
            ...(decision.threadKey && { threadKey: decision.threadKey }),
            ...(decision.title && { title: decision.title }),
          }),
        )
      if (found.outcome === "queued") {
        yield* start(found.replays)
        return true
      }
      const duplicate = { outcome: "duplicate", reason: "an earlier request had this event ID" } as const
      if (yield* earlier(found, decision.eventId)) {
        yield* updateRequest(found.id, { ...duplicate, event_id: decision.eventId ?? null })
        return false
      }
      const locked = yield* database.db
        .update(request)
        .set({
          outcome: "queued",
          replays: sql`${request.replays} + 1`,
          broken: false,
          reason: null,
          event_id: decision.eventId ?? null,
          thread_key: decision.threadKey ?? null,
        })
        .where(and(eq(request.id, found.id), inArray(request.outcome, waiting)))
        .returning({ replays: request.replays })
        .pipe(
          Effect.map((rows) => Option.fromNullishOr(rows.at(0)?.replays)),
          Effect.catchTag(
            "EffectDrizzleQueryError",
            Primitive.uniqueConflict(Database.Schema.webhookRequestEventConstraint, "duplicate"),
          ),
          Effect.catchTag("Primitive.Conflict", () =>
            updateRequest(found.id, duplicate).pipe(Effect.as(Option.none<number>())),
          ),
          Effect.orDie,
        )
      if (Option.isNone(locked)) return false
      yield* start(locked.value)
      return true
    })

    const secretOf = Effect.fnUntraced(function* (row: Row) {
      if (!row.signing_secret) return yield* new Primitive.Conflict({ message: "The webhook has no signing secret." })
      return Redacted.value(yield* open(row, "signing_secret", row.signing_secret))
    })

    return Service.of({
      list: Effect.fn("Webhooks.list")(function* (actor: Actor.Info, input: Webhook.ListInput) {
        const where = and(visibleTo(actor), input.spaceId ? eq(webhook.space_id, input.spaceId) : undefined)
        const found = yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              const rows = yield* transaction
                .select({ webhook, app: appColumns })
                .from(webhook)
                .leftJoin(WebhookPolicy.membership, membershipOf(actor))
                .leftJoin(app, eq(app.id, webhook.app_id))
                .where(where)
                .orderBy(desc(webhook.created_at), desc(webhook.id))
                .limit(input.pageSize)
                .offset((input.page - 1) * input.pageSize)
              const totals = yield* transaction
                .select({ total: count() })
                .from(webhook)
                .leftJoin(WebhookPolicy.membership, membershipOf(actor))
                .where(where)
              const last = yield* lastRequests(
                transaction,
                rows.map((row) => row.webhook.id),
              )
              return { rows, last, total: totals.at(0)?.total ?? 0 }
            }),
          )
          .pipe(Effect.orDie)
        return {
          items: yield* Effect.forEach(found.rows, (row) =>
            toInfo(row.webhook, row.app, found.last.get(row.webhook.id)),
          ),
          page: input.page,
          pageSize: input.pageSize,
          total: found.total,
        }
      }),
      get: Effect.fn("Webhooks.get")(function* (actor: Actor.Info, idOrSlug: string) {
        if (!isID(idOrSlug)) return yield* notFound
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const found = (yield* transaction
              .select({ webhook })
              .from(webhook)
              .leftJoin(WebhookPolicy.membership, membershipOf(actor))
              .where(and(eq(webhook.id, idOrSlug), visibleTo(actor)))).at(0)
            if (!found) return yield* notFound
            return yield* infoOf(transaction, found.webhook)
          }),
        )
      }),
      create: Effect.fn("Webhooks.create")(function* (actor: Actor.Info, input: Webhook.CreateInput) {
        const source = input.source
        if (source._tag === "custom") yield* checked(source.parser)
        const inherited = actor.agent?.spaceId === input.spaceId ? actor.agent.agentId : undefined
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
            const agentId = yield* agentForCreate(transaction, placement, input.agentId, inherited)
            const preset = source._tag === "preset" ? yield* reachedPreset(transaction, placement, source) : undefined
            const taken = yield* transaction
              .select({ slug: webhook.slug })
              .from(webhook)
              .where(and(eq(webhook.space_id, input.spaceId), isNull(webhook.archived_at)))
            const id = Webhook.ID.create()
            const owned = { id, organization_id: actor.organizationId }
            const rows = yield* transaction
              .insert(webhook)
              .values({
                ...owned,
                space_id: input.spaceId,
                slug: yield* Primitive.slugFor(
                  { name: source._tag === "custom" ? source.name : source.preset, slug: input.slug },
                  "webhook",
                  new Set(taken.map((row) => row.slug)),
                ),
                ...columnsOf(source),
                owner_id: actor.userId,
                agent_id: agentId ?? null,
                token: yield* seal(owned, "token", random()),
                ...(preset?.secret === "ren" && { signing_secret: yield* seal(owned, "signing_secret", random()) }),
                created_by: actor.userId,
              })
              .returning()
              .pipe(
                Effect.catchTag(
                  "EffectDrizzleQueryError",
                  Primitive.uniqueConflict(Database.Schema.webhookSlugConstraint, "A webhook with this slug exists."),
                ),
                Effect.catchTag(
                  "EffectDrizzleQueryError",
                  Primitive.uniqueConflict(
                    Database.Schema.webhookPresetConstraint,
                    "The space has turned on this preset already.",
                  ),
                ),
              )
            return yield* written(transaction, rows)
          }),
        )
      }),
      update: Effect.fn("Webhooks.update")(function* (actor: Actor.Info, id: Webhook.ID, input: Webhook.UpdateInput) {
        const parser = input.parser ? yield* checked(input.parser) : undefined
        if (input.fallbackUserId && input.fallbackUserId !== actor.userId)
          return yield* invalid("You can set only yourself as the fallback user.", "fallbackUserId")
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* find(transaction, actor, id, actions.update)
            const source = yield* WebhookSource.of(row)
            const fixed = fixedOf(source, input)
            if (Option.isSome(fixed))
              return yield* invalid(`The ${fixed.value} of a preset comes from its app.`, fixed.value)
            if (input.agentId)
              yield* checkedAgent(
                transaction,
                { organizationId: row.organization_id, spaceId: row.space_id },
                input.agentId,
              )
            const ownerId = ownerAfter(row, input, actor)
            if (input.mode === "live") {
              // ast-grep-ignore: no-nullish-comparison, -- null clears the agent; undefined leaves it
              const next = { ...row, agent_id: input.agentId === undefined ? row.agent_id : input.agentId }
              const current = parser ?? (yield* currentOf(transaction, row, source)).parser
              const problem = yield* liveProblem(transaction, next, ownerId, current)
              if (Option.isSome(problem)) return yield* invalid(problem.value, "mode")
            }
            const rows = yield* transaction
              .update(webhook)
              .set({
                name: input.name,
                message: input.message,
                ...(parser && { parser: encodeParser(parser) }),
                agent_id: input.agentId,
                fallback_user_id: input.fallbackUserId,
                ...(input.mode && { mode: input.mode, mode_reason: null }),
                owner_id: ownerId,
                updated_at: sql`now()`,
              })
              .where(eq(webhook.id, id))
              .returning()
            return yield* written(transaction, rows)
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
              transaction,
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
      revealSigningSecret: Effect.fn("Webhooks.revealSigningSecret")(function* (actor: Actor.Info, id: Webhook.ID) {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* find(transaction, actor, id, actions.revealSigningSecret)
            return { record: yield* infoOf(transaction, row), secret: yield* secretOf(row) }
          }),
        )
      }),
      test: Effect.fn("Webhooks.test")(function* (actor: Actor.Info, id: Webhook.ID, input: Webhook.TestInput) {
        const row = yield* readable(actor, id, actions.test)
        const parser = input.parser ?? (yield* parserNow(row))
        const secret = yield* secretOption(row)
        const found = yield* database.db
          .select()
          .from(request)
          .where(
            and(eq(request.webhook_id, row.id), input.requestIds ? inArray(request.id, input.requestIds) : undefined),
          )
          .orderBy(desc(request.received_at), desc(request.id))
          .limit(input.requestIds?.length ?? testedByDefault)
          .pipe(Effect.orDie)
        return { items: yield* Effect.forEach(found, (each) => tested(parser, secret, each)) }
      }),
      replay: Effect.fn("Webhooks.replay")(function* (actor: Actor.Info, id: Webhook.ID) {
        const row = yield* database.transaction((transaction) => find(transaction, actor, id, actions.replay))
        if (row.mode !== "live") return yield* new Primitive.Conflict({ message: "Switch the webhook to live first." })
        const parser = yield* parserNow(row)
        const secret = yield* secretOption(row)
        const found = yield* database.db
          .select()
          .from(request)
          .where(and(eq(request.webhook_id, row.id), inArray(request.outcome, [...waiting, "queued"])))
          .orderBy(sql`${request.outcome} = 'queued'`, request.received_at, request.id)
          .limit(replayBatch)
          .pipe(Effect.orDie)
        const started = yield* Effect.forEach(found, (each) => replayed(row, parser, secret, each))
        const left = yield* database.db
          .select({ total: count() })
          .from(request)
          .where(and(eq(request.webhook_id, row.id), inArray(request.outcome, waiting)))
          .pipe(Effect.orDie)
        return { replayed: started.filter(Boolean).length, remaining: left.at(0)?.total ?? 0 }
      }),
      requests: {
        list: Effect.fn("Webhooks.requests.list")(function* (actor: Actor.Info, input: WebhookRequest.ListInput) {
          const empty = { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
          if (Option.isNone(yield* Effect.option(readable(actor, input.webhookId, actions.requests)))) return empty
          const where = and(
            eq(request.webhook_id, input.webhookId),
            input.outcome ? eq(request.outcome, input.outcome) : undefined,
          )
          const rows = yield* database.db
            .select(requestColumns)
            .from(request)
            .where(where)
            .orderBy(desc(request.received_at), desc(request.id))
            .limit(input.pageSize)
            .offset((input.page - 1) * input.pageSize)
            .pipe(Effect.orDie)
          const totals = yield* database.db.select({ total: count() }).from(request).where(where).pipe(Effect.orDie)
          return {
            ...empty,
            items: rows.map((row): WebhookRequest.Info => requestInfo(row)),
            total: totals.at(0)?.total ?? 0,
          }
        }),
        get: Effect.fn("Webhooks.requests.get")(function* (actor: Actor.Info, id: WebhookRequest.ID) {
          const found = (yield* database.db
            .select({ ...requestColumns, query: request.query, headers: request.headers, body: request.body })
            .from(request)
            .where(eq(request.id, id))
            .pipe(Effect.orDie)).at(0)
          if (!found) return yield* new Primitive.NotFound({ message: "Request not found." })
          yield* readable(actor, found.webhookId, actions.request).pipe(
            Effect.mapError(() => new Primitive.NotFound({ message: "Request not found." })),
          )
          return requestInfo(found) satisfies WebhookRequest.Detail
        }),
      },
    })
  }),
)
