export * as Usage from "./usage.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import { Models } from "@ren/schema/models"
import { RegisteredKey } from "@ren/schema/registered-key"
import { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { Usage } from "@ren/schema/usage"
import { Random } from "@ren/util/random"
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { Context, DateTime, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { Access } from "./access.js"
import { AgentQueries } from "./agent/queries.js"
import { SpaceQueries } from "./space/queries.js"

export { Batch, Event, Recorded, headers, meters } from "@ren/schema/usage"

export class Forbidden extends Schema.TaggedError<Forbidden>()("Usage.Forbidden", { message: Schema.String }) {}

export class Unavailable extends Schema.TaggedError<Unavailable>()("Usage.Unavailable", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly authenticate: (key: Redacted.Redacted) => Effect.Effect<Option.Option<string>>
  readonly record: (
    producer: string,
    events: ReadonlyArray<Usage.Event>,
  ) => Effect.Effect<Usage.Recorded, Forbidden | Unavailable>
  // oxlint-disable-next-line ren/no-comments -- Checks the claims of up to batchSize stored events and returns how many it checked.
  readonly reconcile: Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Usage") {}

export const batchSize = 500

const keys = Database.Schema.registered_key
const events = Database.Schema.usage_event
const pending = Database.Schema.usage_pending
const attribution = Database.Schema.usage_attribution
const sessions = Database.Schema.agent_session
const agents = Database.Schema.agent
const brains = Database.Schema.brain

const hash = (secret: string) => new Bun.CryptoHasher("sha256").update(secret).digest("hex")

export const issueKey = Effect.fn("Usage.issueKey")(function* (producer: string) {
  const database = yield* Database.Service
  const secret = `ren_usage_${Random.token(32)}`
  const id = RegisteredKey.ID.create()
  yield* database.db
    .insert(keys)
    .values({ id, kind: "usage", producer, secret_hash: hash(secret) })
    .pipe(Effect.orDie)
  return { id, secret: Redacted.make(secret) }
})

const decodeSession = Schema.decodeUnknownOption(Session.ID)
const decodeMember = Schema.decodeUnknownOption(Auth.MemberID)
const decodeKind = Schema.decodeUnknownOption(Usage.Kind)

// oxlint-disable-next-line ren/no-comments -- A brain names the member by placeholder (ren:PERSON.mem_…). The egress puts the ID in; a host without the egress, or another proxy, leaves the placeholder, and Ren reads it the same way.
const personPrefix = Models.personPlaceholder("")
const maxAge = Duration.days(30)
const maxAhead = Duration.minutes(5)
const maxClaim = 256

const claim = (value: string | null) => (value && value.length <= maxClaim ? value : null)

type Stored = typeof events.$inferSelect

interface SessionRow {
  readonly brainId: Brain.ID
  readonly parentId: Session.ID | null
  readonly rootId: Session.ID
}

// oxlint-disable-next-line ren/no-comments -- Ren keeps the root when it is a root chat of the event's brain, and the session when it is that root, one of its children, or a child that has not synced yet (§4.3).
const sessionsOf = (event: Stored, brainId: Brain.ID | null, rows: ReadonlyMap<Session.ID, SessionRow>) => {
  const root = Option.getOrNull(
    Option.filter(decodeSession(claim(event.root_session)), (id) => {
      const row = rows.get(id)
      return Boolean(brainId) && row?.brainId === brainId && !row.parentId
    }),
  )
  const session = Option.getOrNull(
    Option.filter(decodeSession(claim(event.session)), (id) => {
      const row = rows.get(id)
      return Boolean(root) && (id === root || !row || row.rootId === root)
    }),
  )
  return { root, session: root ? session : null }
}

interface BrainRow {
  readonly id: Brain.ID
  readonly organizationId: string
  readonly spaceId: Space.ID
}

// oxlint-disable-next-line ren/no-comments -- The brain must be in the event's organization, or Ren keeps no claim. The space is the brain's; a deleted brain has no row to check against, so the space from the producer's key stays.
const scopeOf = (row: Stored, brain: BrainRow | undefined) => {
  const own = brain?.organizationId === row.organization ? brain : undefined
  return {
    brainId: own?.id ?? null,
    spaceId: brain ? (own?.spaceId ?? null) : row.space,
    problems: [...brainProblems(row, brain, own), ...(inRange(row) ? [] : ["time_out_of_range"])],
  }
}

const brainProblems = (row: Stored, brain: BrainRow | undefined, own: BrainRow | undefined) => [
  ...(row.brain && !brain ? ["unknown_brain"] : []),
  ...(brain && !own ? ["organization_mismatch"] : []),
  ...(row.space && own && row.space !== own.spaceId ? ["space_mismatch"] : []),
]

const inRange = (row: Stored) =>
  row.time.getTime() >= row.received_at.getTime() - Duration.toMillis(maxAge) &&
  row.time.getTime() <= row.received_at.getTime() + Duration.toMillis(maxAhead)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const unavailable = () => new Unavailable({ message: "The usage store is not available." })

    // oxlint-disable-next-line ren/no-comments -- The checks of reconciliation (§4.3). Org and brain come from the producer's key and are kept; the space is the brain's; every claim that does not agree with Ren's rows becomes null.
    const check = Effect.fnUntraced(function* (transaction: Database.Transaction, rows: ReadonlyArray<Stored>) {
      const brainIds = [...new Set(rows.flatMap((row) => (row.brain ? [row.brain] : [])))]
      const brainRows = new Map(
        brainIds.length === 0
          ? []
          : (yield* transaction
              .select({ id: brains.id, organizationId: brains.organization_id, spaceId: brains.space_id })
              .from(brains)
              .where(inArray(brains.id, brainIds))).map((row) => [row.id, row] as const),
      )
      const sessionIds = [
        ...new Set(
          rows.flatMap((row) =>
            [row.root_session, row.session].flatMap((value) => Option.toArray(decodeSession(claim(value)))),
          ),
        ),
      ]
      const sessionRows = new Map(
        sessionIds.length === 0
          ? []
          : (yield* transaction
              .select({
                id: sessions.id,
                brainId: sessions.brain_id,
                parentId: sessions.parent_id,
                rootId: sessions.root_id,
              })
              .from(sessions)
              .where(inArray(sessions.id, sessionIds))).map((row) => [row.id, row] as const),
      )

      const resolved = rows.map((row) => {
        const scope = scopeOf(row, row.brain ? brainRows.get(row.brain) : undefined)
        const kept = sessionsOf(row, scope.brainId, sessionRows)
        const member = Option.getOrNull(decodeMember(claim(row.member)?.replace(personPrefix, "")))
        const agentName = claim(row.agent_name)
        const spaceId = scope.spaceId
        return {
          row,
          spaceId,
          ...kept,
          problems: scope.problems,
          member: member &&
            spaceId && { key: `${member}\n${spaceId}`, member, spaceId, organizationId: row.organization },
          agent:
            kept.root && agentName && spaceId
              ? { key: `${agentName}\n${spaceId}`, name: agentName, spaceId, organizationId: row.organization }
              : null,
        }
      })
      const distinct = <A extends { readonly key: string }>(items: ReadonlyArray<A | null>) =>
        new Map(items.flatMap((item) => (item ? [[item.key, item] as const] : []))).values()

      const members = new Set(
        (yield* Effect.forEach(distinct(resolved.map((entry) => entry.member)), (check) =>
          Effect.gen(function* () {
            const found = (yield* transaction
              .select({ userId: Database.Schema.member.userId })
              .from(Database.Schema.member)
              .where(
                and(
                  eq(Database.Schema.member.id, check.member),
                  eq(Database.Schema.member.organizationId, check.organizationId),
                ),
              )).at(0)
            const acts =
              found &&
              (yield* SpaceQueries.actsIn(
                transaction,
                access,
                check.organizationId,
                check.spaceId,
                Auth.UserID.make(found.userId),
              ))
            return acts ? [check.key] : []
          }),
        )).flat(),
      )

      const agentIds = new Map(
        yield* Effect.forEach(distinct(resolved.map((entry) => entry.agent)), (check) =>
          Effect.gen(function* () {
            const found = (yield* transaction
              .select({ id: agents.id })
              .from(agents)
              .where(
                and(
                  eq(agents.name, check.name),
                  isNull(agents.archived_at),
                  or(
                    isNull(agents.organization_id),
                    and(eq(agents.organization_id, check.organizationId), AgentQueries.isInSpace(check.spaceId)),
                  ),
                ),
              )
              // oxlint-disable-next-line ren/no-comments -- An organization's agent wins over a global agent of the same name.
              .orderBy(asc(sql`${agents.organization_id} is null`))
              .limit(1)).at(0)
            return [check.key, found?.id] as const
          }),
        ),
      )

      return resolved.map((entry) => ({
        source: entry.row.source,
        id: entry.row.id,
        space: entry.spaceId,
        root_session: entry.root,
        session: entry.session,
        turn: entry.root ? claim(entry.row.turn) : null,
        member: entry.member && members.has(entry.member.key) ? entry.member.member : null,
        agent: (entry.agent && agentIds.get(entry.agent.key)) ?? null,
        kind: Option.getOrNull(decodeKind(entry.row.kind)),
        problems: entry.problems,
      }))
    })

    return Service.of({
      authenticate: Effect.fn("Usage.authenticate")(function* (key: Redacted.Redacted) {
        const rows = yield* database.db
          .select({ producer: keys.producer })
          .from(keys)
          .where(and(eq(keys.kind, "usage"), eq(keys.secret_hash, hash(Redacted.value(key))), isNull(keys.revoked_at)))
          .pipe(Effect.orDie)
        return Option.fromNullishOr(rows.at(0)?.producer)
      }),
      // oxlint-disable-next-line ren/no-comments -- The hot path: Ren stores what the producer sent and checks nothing but the producer of the key. The organization and brain come from the producer's key; reconciliation checks the rest later.
      record: Effect.fn("Usage.record")(
        function* (producer: string, batch: ReadonlyArray<Usage.Event>) {
          const foreign = batch.find((event) => event.source !== producer)
          if (foreign)
            return yield* new Forbidden({ message: `The key of ${producer} cannot send events of ${foreign.source}.` })
          return yield* database.db.transaction((transaction) =>
            Effect.gen(function* () {
              const inserted = yield* transaction
                .insert(events)
                .values(
                  batch.map((event) => ({
                    source: event.source,
                    id: event.id,
                    type: event.type,
                    time: DateTime.toDateUtc(event.time),
                    workload: event.workload,
                    organization: event.organization,
                    brain: event.brain,
                    space: event.space,
                    root_session: event.root_session,
                    session: event.session,
                    turn: event.turn,
                    member: event.member,
                    agent_name: event.agent,
                    kind: event.kind,
                    requested_model: event.requested_model,
                    variant: event.variant,
                    payer: event.payer,
                    provider: event.provider,
                    served_model: event.served_model,
                    input_tokens: event.input_tokens,
                    output_tokens: event.output_tokens,
                    reasoning_tokens: event.reasoning_tokens,
                    cache_read_tokens: event.cache_read_tokens,
                    cache_write_tokens: event.cache_write_tokens,
                    cache_write_1h_tokens: event.cache_write_1h_tokens,
                    cost_micro_usd: event.cost_micro_usd ?? null,
                    latency_ms: event.latency_ms,
                    time_to_first_token_ms: event.time_to_first_token_ms,
                    stop_reason: event.stop_reason,
                    error: event.error,
                  })),
                )
                .onConflictDoNothing()
                .returning({ source: events.source, id: events.id })
              if (inserted.length > 0) yield* transaction.insert(pending).values(inserted)
              return { inserted: inserted.length }
            }),
          )
        },
        Effect.catchTags({
          EffectDrizzleQueryError: (error) => Effect.logError(error).pipe(Effect.andThen(Effect.fail(unavailable()))),
          SqlError: (error) => Effect.logError(error).pipe(Effect.andThen(Effect.fail(unavailable()))),
        }),
      ),
      reconcile: Effect.gen(function* () {
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const rows = yield* transaction
              .select({ event: events })
              .from(pending)
              .innerJoin(events, and(eq(events.source, pending.source), eq(events.id, pending.id)))
              .orderBy(asc(events.received_at))
              .limit(batchSize)
              .for("update", { of: pending, skipLocked: true })
            if (rows.length === 0) return 0
            const checked = yield* check(
              transaction,
              rows.map((row) => row.event),
            )
            yield* transaction.insert(attribution).values(checked).onConflictDoNothing()
            yield* transaction
              .delete(pending)
              .where(or(...rows.map((row) => and(eq(pending.source, row.event.source), eq(pending.id, row.event.id)))))
            const flagged = checked.filter((row) => row.problems.length > 0)
            if (flagged.length > 0)
              yield* Effect.logError(
                "Usage events with problems",
                flagged.map((row) => `${row.source}:${row.id} ${row.problems.join(",")}`),
              )
            return rows.length
          }),
        )
      }).pipe(Effect.withSpan("Usage.reconcile")),
    })
  }),
)

// oxlint-disable-next-line ren/no-comments -- Each Ren server runs this loop; SKIP LOCKED lets copies share the work. After a full batch it runs again at once; else it waits.
export const layerReconcile = Layer.effectDiscard(
  Effect.gen(function* () {
    const usage = yield* Service
    yield* usage.reconcile.pipe(
      Effect.catchCause((cause) => Effect.logError("Usage reconciliation failed", cause).pipe(Effect.as(0))),
      Effect.flatMap((checked) => (checked < batchSize ? Effect.sleep(Duration.seconds(30)) : Effect.void)),
      Effect.forever,
      Effect.forkScoped,
    )
  }),
)
