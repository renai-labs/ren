export * as Usage from "./usage.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import { Models } from "@ren/schema/models"
import { RegisteredKey } from "@ren/schema/registered-key"
import { Session } from "@ren/schema/session"
import { Usage } from "@ren/schema/usage"
import { Workload } from "@ren/schema/workload"
import { Random } from "@ren/util/random"
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import { Clock, Context, DateTime, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import { Access } from "./access.js"
import { AgentQueries } from "./agent/queries.js"
import { Credentials } from "./credentials.js"
import { SpaceQueries } from "./space/queries.js"

export { Batch, Event, Recorded, headers, meters } from "@ren/schema/usage"

export class Invalid extends Schema.TaggedError<Invalid>()("Usage.Invalid", { message: Schema.String }) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()("Usage.Forbidden", { message: Schema.String }) {}

export class Unavailable extends Schema.TaggedError<Unavailable>()("Usage.Unavailable", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly authenticate: (key: Redacted.Redacted) => Effect.Effect<Option.Option<string>>
  readonly record: (
    producer: string,
    events: ReadonlyArray<Usage.Event>,
  ) => Effect.Effect<Usage.Recorded, Invalid | Forbidden | Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Usage") {}

const keys = Database.Schema.registered_key
const events = Database.Schema.usage_event
const sessions = Database.Schema.agent_session
const agents = Database.Schema.agent

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

const workloadPattern = /^(brain|hand):([^:]+)(?::(\d+))?$/u
const decodeWorkload = Schema.decodeUnknownOption(Workload.Info)
const decodeSession = Schema.decodeUnknownOption(Session.ID)
const decodeMember = Schema.decodeUnknownOption(Auth.MemberID)
const decodeKind = Schema.decodeUnknownOption(Usage.Kind)

// oxlint-disable-next-line ren/no-comments -- A brain names the member by placeholder (ren:PERSON.mem_…). The egress puts the ID in; a host without the egress, or another proxy, leaves the placeholder, and Ren reads it the same way.
const personPrefix = Models.personPlaceholder("")
const maxAge = Duration.days(30)
const maxAhead = Duration.minutes(5)
const maxClaim = 256

// oxlint-disable-next-line ren/no-comments -- A claim longer than any real ID or name is dropped, never refused, so a brain cannot make Ren refuse the batch of its own costs (§1.3).
const claim = (value: string | undefined) => (value && value.length <= maxClaim ? value : null)

interface SessionRow {
  readonly brainId: Brain.ID
  readonly parentId: Session.ID | null
  readonly rootId: Session.ID
}

// oxlint-disable-next-line ren/no-comments -- Ren keeps the root when it is a root chat of the workload's brain, and the session when it is that root, one of its children, or a child that has not synced yet (§4.3).
const sessionsOf = (event: Usage.Event, brainId: Brain.ID, rows: ReadonlyMap<Session.ID, SessionRow>) => {
  const root = Option.getOrNull(
    Option.filter(decodeSession(claim(event.root_session)), (id) => {
      const row = rows.get(id)
      return row?.brainId === brainId && !row.parentId
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

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const unavailable = () => new Unavailable({ message: "The usage store is not available." })

    return Service.of({
      authenticate: Effect.fn("Usage.authenticate")(function* (key: Redacted.Redacted) {
        const rows = yield* database.db
          .select({ producer: keys.producer })
          .from(keys)
          .where(and(eq(keys.kind, "usage"), eq(keys.secret_hash, hash(Redacted.value(key))), isNull(keys.revoked_at)))
          .pipe(Effect.orDie)
        return Option.fromNullishOr(rows.at(0)?.producer)
      }),
      record: Effect.fn("Usage.record")(
        function* (producer: string, batch: ReadonlyArray<Usage.Event>) {
          const foreign = batch.find((event) => event.source !== producer)
          if (foreign)
            return yield* new Forbidden({ message: `The key of ${producer} cannot send events of ${foreign.source}.` })
          const now = yield* Clock.currentTimeMillis
          const invalid = batch.flatMap((event) => {
            const at = DateTime.toEpochMillis(event.time)
            const extra = Usage.Quantity.literals.filter(
              // ast-grep-ignore: no-nullish-comparison, -- a quantity of 0 is still a quantity that the type must allow
              (quantity) => event[quantity] !== undefined && !Usage.meters[event.type].includes(quantity),
            )
            return [
              ...(at < now - Duration.toMillis(maxAge) || at > now + Duration.toMillis(maxAhead)
                ? [`${event.id}: time is out of range`]
                : []),
              ...extra.map((quantity) => `${event.id}: ${event.type} has no ${quantity}`),
            ]
          })
          if (invalid.length > 0) return yield* new Invalid({ message: invalid.join("; ") })

          const scopes = yield* Effect.forEach(new Set(batch.map((event) => event.workload)), (text) =>
            Effect.gen(function* () {
              const match = workloadPattern.exec(text)
              const workload = decodeWorkload({
                kind: match?.at(1),
                id: match?.at(2),
                generation: Number(match?.at(3) ?? 1),
              })
              if (Option.isNone(workload)) return { text, scope: Option.none<Credentials.Scope>() }
              return { text, scope: yield* Credentials.scopeOf(database.db, workload.value) }
            }),
          )
          const unknown = scopes.filter((entry) => Option.isNone(entry.scope)).map((entry) => entry.text)
          const workloads = new Map(
            scopes.flatMap((entry) => (Option.isSome(entry.scope) ? [[entry.text, entry.scope.value] as const] : [])),
          )
          if (unknown.length > 0) return yield* new Invalid({ message: `Unknown workload: ${unknown.join(", ")}` })

          const sessionIds = [
            ...new Set(
              batch.flatMap((event) =>
                [event.root_session, event.session].flatMap((value) => Option.toArray(decodeSession(claim(value)))),
              ),
            ),
          ]
          const sessionRows = new Map(
            sessionIds.length === 0
              ? []
              : (yield* database.db
                  .select({
                    id: sessions.id,
                    brainId: sessions.brain_id,
                    parentId: sessions.parent_id,
                    rootId: sessions.root_id,
                  })
                  .from(sessions)
                  .where(inArray(sessions.id, sessionIds))).map((row) => [row.id, row] as const),
          )

          const resolved = batch.flatMap((event) => {
            const found = workloads.get(event.workload)
            if (!found || Option.isNone(found.spaceId)) return []
            const scope = { organizationId: found.organizationId, spaceId: found.spaceId.value }
            const kept = sessionsOf(event, found.brainId, sessionRows)
            const member = Option.getOrNull(decodeMember(claim(event.member)?.replace(personPrefix, "")))
            const agentName = claim(event.agent)
            return [
              {
                event,
                brainId: found.brainId,
                ...scope,
                ...kept,
                agentName,
                member: member && { ...scope, key: `${member}\n${scope.spaceId}`, member },
                agent:
                  kept.root && agentName ? { ...scope, key: `${agentName}\n${scope.spaceId}`, name: agentName } : null,
              },
            ]
          })
          const distinct = <A extends { readonly key: string }>(items: ReadonlyArray<A | null>) =>
            new Map(items.flatMap((item) => (item ? [[item.key, item] as const] : []))).values()

          const members = new Set(
            (yield* Effect.forEach(distinct(resolved.map((row) => row.member)), (check) =>
              Effect.gen(function* () {
                const found = (yield* database.db
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
                    database.db,
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
            yield* Effect.forEach(distinct(resolved.map((row) => row.agent)), (check) =>
              database.db
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
                .limit(1)
                .pipe(Effect.map((rows) => [check.key, rows.at(0)?.id] as const)),
            ),
          )

          const inserted = yield* database.db
            .insert(events)
            .values(
              resolved.map((row) => {
                const agent = row.agent ? agentIds.get(row.agent.key) : undefined
                return {
                  source: row.event.source,
                  id: row.event.id,
                  type: row.event.type,
                  time: DateTime.toDateUtc(row.event.time),
                  workload: row.event.workload,
                  organization: row.organizationId,
                  space: row.spaceId,
                  brain: row.brainId,
                  root_session: row.root,
                  session: row.session,
                  turn: row.root ? claim(row.event.turn) : null,
                  member: row.member && members.has(row.member.key) ? row.member.member : null,
                  agent: agent ?? null,
                  agent_name: agent ? null : row.agentName,
                  kind: Option.getOrNull(decodeKind(row.event.kind)),
                  requested_model: row.event.requested_model,
                  variant: claim(row.event.variant),
                  payer: row.event.payer,
                  provider: row.event.provider,
                  served_model: row.event.served_model,
                  input_tokens: row.event.input_tokens,
                  output_tokens: row.event.output_tokens,
                  reasoning_tokens: row.event.reasoning_tokens,
                  cache_read_tokens: row.event.cache_read_tokens,
                  cache_write_tokens: row.event.cache_write_tokens,
                  cache_write_1h_tokens: row.event.cache_write_1h_tokens,
                  cost_micro_usd: row.event.cost_micro_usd ?? null,
                  latency_ms: row.event.latency_ms,
                  time_to_first_token_ms: row.event.time_to_first_token_ms,
                  stop_reason: row.event.stop_reason,
                  error: row.event.error,
                }
              }),
            )
            .onConflictDoNothing()
            .returning({ id: events.id })
          return { inserted: inserted.length }
        },
        Effect.catchTag("EffectDrizzleQueryError", (error) =>
          Effect.logError(error).pipe(Effect.andThen(Effect.fail(unavailable()))),
        ),
      ),
    })
  }),
)
