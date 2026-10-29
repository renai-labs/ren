export * as Insights from "./insights.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { Insights } from "@ren/schema/insights"
import { Models } from "@ren/schema/models"
import type { Space as SpaceSchema } from "@ren/schema/space"
import { and, count, countDistinct, eq, gte, inArray, lt, type SQL, type SQLWrapper, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Context, DateTime, Effect, Layer, Order, Predicate } from "effect"
import type { Actor } from "./actor.js"
import type { Primitive } from "./primitive.js"
import { Space } from "./space.js"

export interface Interface {
  readonly query: (actor: Actor.Info, query: Insights.Query) => Effect.Effect<Insights.Result, Primitive.NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Insights") {}

type Client = Database.Interface["db"]

type Unit = "hour" | "day" | "week"

type Key = SQL<string | null>

interface Scope {
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: SpaceSchema.ID
  readonly query: Insights.Query
}

const events = Database.Schema.usage_event
const tasks = Database.Schema.task
const trail = Database.Schema.task_event
const links = Database.Schema.task_link
const agents = Database.Schema.agent
const members = Database.Schema.member
const users = Database.Schema.user
const later = alias(Database.Schema.task_event, "later_event")

const isoFormat = 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'

const personPrefix = Models.personPlaceholder("")

const unitOf = (groupBy: Insights.GroupBy): Unit | null =>
  groupBy === "hour" || groupBy === "day" || groupBy === "week" ? groupBy : null

const hasTasks = (groupBy: Insights.GroupBy) => groupBy !== "model" && groupBy !== "provider"

const total = (expression: SQL) => sql<number>`coalesce(${expression}, 0)`.mapWith(Number)

const field = (name: keyof typeof events.$inferSelect.data) => sql<string | null>`${events.data} ->> ${name}`

const tokens = (...names: ReadonlyArray<keyof typeof events.$inferSelect.data>) =>
  total(
    sql`sum(${sql.join(
      names.map((name) => sql`coalesce((${field(name)})::bigint, 0)`),
      sql` + `,
    )})`,
  )

const person = sql<string | null>`case when starts_with(${events.member}, ${personPrefix})
  then substr(${events.member}, ${personPrefix.length + 1}) else ${events.member} end`

const usageKeys: Partial<Record<Insights.GroupBy, Key>> = {
  member: sql`coalesce(${members.userId}, ${person})`,
  agent: sql`${events.agent}`,
  model: field("served_model"),
  provider: sql`${events.provider}`,
}

const taskKeys: Partial<Record<Insights.GroupBy, Key>> = {
  member: sql`${tasks.owner_id}`,
  agent: sql`${agents.name}`,
}

const keyOf = (query: Insights.Query, column: SQLWrapper, keys: Partial<Record<Insights.GroupBy, Key>>): Key => {
  const unit = unitOf(query.groupBy)
  if (unit)
    return sql`to_char(date_trunc(${unit}, ${column} at time zone 'UTC', ${query.timezone}) at time zone 'UTC', ${isoFormat})`
  return keys[query.groupBy] ?? sql`null::text`
}

const inRange = (
  column: typeof events.time | typeof trail.created_at | typeof links.created_at,
  query: Insights.Query,
) => and(gte(column, DateTime.toDateUtc(query.from)), lt(column, DateTime.toDateUtc(query.to)))

const usageQuery = (db: Client, scope: Scope) =>
  db
    .select({
      key: keyOf(scope.query, events.time, usageKeys),
      sessions: countDistinct(events.root_session),
      calls: total(sql`count(*) filter (where ${events.type} = 'model.call')`),
      errors: count(events.error),
      tokens: {
        input: tokens("input_tokens"),
        output: tokens("output_tokens"),
        reasoning: tokens("reasoning_tokens"),
        cacheRead: tokens("cache_read_tokens"),
        cacheWrite: tokens("cache_write_tokens", "cache_write_1h_tokens"),
      },
      cost: {
        ren: total(sql`sum(${events.cost_micro_usd}) filter (where ${events.payer} = 'ren')`),
        customer: total(sql`sum(${events.cost_micro_usd}) filter (where ${events.payer} = 'customer')`),
        unpricedCalls: total(sql`count(*) filter (where ${events.cost_micro_usd} is null)`),
      },
    })
    .from(events)
    .leftJoin(members, and(sql`${members.id} = ${person}`, eq(members.organizationId, scope.organizationId)))
    .where(
      and(
        eq(events.organization, scope.organizationId),
        eq(events.space, scope.spaceId),
        inRange(events.time, scope.query),
        scope.query.userId && inArray(members.userId, [...scope.query.userId]),
        scope.query.agent && inArray(events.agent, [...scope.query.agent]),
        scope.query.model && inArray(field("served_model"), [...scope.query.model]),
        scope.query.payer && eq(events.payer, scope.query.payer),
        scope.query.kind && eq(field("kind"), scope.query.kind),
      ),
    )
    .groupBy(sql`1`)

const taskWhere = (scope: Scope) =>
  and(
    eq(tasks.organization_id, scope.organizationId),
    eq(tasks.space_id, scope.spaceId),
    scope.query.userId && inArray(tasks.owner_id, [...scope.query.userId]),
    scope.query.agent && inArray(agents.name, [...scope.query.agent]),
  )

const isLatestDone = sql`${tasks.status} = 'done' and not exists (
  select 1 from ${trail} as ${later}
  where ${later.task_id} = ${trail.task_id}
    and ${later.kind} = 'status' and ${later.data} ->> 'to' = 'done'
    and (${later.created_at}, ${later.id}) > (${trail.created_at}, ${trail.id})
)`

const doneQuery = (db: Client, scope: Scope) =>
  db
    .select({
      key: keyOf(scope.query, trail.created_at, taskKeys),
      tasksDone: total(sql`count(distinct ${trail.task_id}) filter (where ${isLatestDone})`),
      prsMerged: total(sql`count(distinct ${trail.data} -> 'automation' ->> 'url')
        filter (where ${trail.data} -> 'automation' ->> 'cause' = 'pull_request_merged')`),
    })
    .from(trail)
    .innerJoin(tasks, eq(tasks.id, trail.task_id))
    .leftJoin(agents, eq(agents.id, tasks.agent_id))
    .where(
      and(
        eq(trail.organization_id, scope.organizationId),
        sql`${trail.kind} = 'status' and ${trail.data} ->> 'to' = 'done'`,
        inRange(trail.created_at, scope.query),
        taskWhere(scope),
      ),
    )
    .groupBy(sql`1`)

const linkedQuery = (db: Client, scope: Scope) =>
  db
    .select({ key: keyOf(scope.query, links.created_at, taskKeys), prsLinked: countDistinct(links.key) })
    .from(links)
    .innerJoin(tasks, eq(tasks.id, links.task_id))
    .leftJoin(agents, eq(agents.id, tasks.agent_id))
    .where(
      and(
        eq(links.organization_id, scope.organizationId),
        eq(links.kind, "github_pr"),
        inRange(links.created_at, scope.query),
        taskWhere(scope),
      ),
    )
    .groupBy(sql`1`)

const bucketsQuery = (db: Client, query: Insights.Query, unit: Unit) =>
  db.select({ key: sql<string>`to_char(bucket at time zone 'UTC', ${isoFormat})` }).from(
    sql`generate_series(
      date_trunc(${unit}, ${DateTime.formatIso(query.from)}::timestamptz, ${query.timezone}),
      ${DateTime.formatIso(query.to)}::timestamptz - interval '1 microsecond',
      ${`1 ${unit}`}::interval,
      ${query.timezone}
    ) as bucket`,
  )

const noSpend = {
  sessions: 0,
  calls: 0,
  errors: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  cost: { ren: 0, customer: 0, unpricedCalls: 0 },
}

const measures: Record<Insights.OrderBy, (row: Insights.Row) => number> = {
  cost: (row) => row.cost.ren + row.cost.customer,
  tokens: (row) =>
    row.tokens.input + row.tokens.output + row.tokens.reasoning + row.tokens.cacheRead + row.tokens.cacheWrite,
  calls: (row) => row.calls,
  sessions: (row) => row.sessions,
  tasksDone: (row) => row.tasksDone ?? 0,
}

const orderOf = (orderBy: Insights.OrderBy) =>
  Order.combineAll([
    Order.flip(Order.mapInput(Order.Number, measures[orderBy])),
    Order.mapInput(Order.Boolean, (row: Insights.Row) => !row.key),
    Order.mapInput(Order.String, (row: Insights.Row) => row.key ?? ""),
  ])

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const spaces = yield* Space.Service

    return Service.of({
      query: Effect.fn("Insights.query")(function* (actor: Actor.Info, query: Insights.Query) {
        const space = yield* spaces.get(actor, query.spaceId)
        const scope = { organizationId: space.organizationId, spaceId: space.id, query }
        const unit = unitOf(query.groupBy)
        const withTasks = hasTasks(query.groupBy)
        const results = yield* Effect.all(
          {
            spent: usageQuery(database.db, scope),
            done: withTasks ? doneQuery(database.db, scope) : Effect.succeed([]),
            linked: withTasks ? linkedQuery(database.db, scope) : Effect.succeed([]),
            buckets: unit ? bucketsQuery(database.db, query, unit) : Effect.succeed([]),
          },
          { concurrency: "unbounded" },
        ).pipe(Effect.orDie)
        const spent = new Map(results.spent.map((row) => [row.key, row]))
        const done = new Map(results.done.map((row) => [row.key, row]))
        const linked = new Map(results.linked.map((row) => [row.key, row]))
        const rowOf = (key: string | null, label: string | null): Insights.Row => ({
          ...noSpend,
          ...spent.get(key),
          key,
          label,
          tasksDone: withTasks ? (done.get(key)?.tasksDone ?? 0) : null,
          prsMerged: withTasks ? (done.get(key)?.prsMerged ?? 0) : null,
          prsLinked: withTasks ? (linked.get(key)?.prsLinked ?? 0) : null,
        })

        if (query.groupBy === "none") return { rows: [rowOf(null, null)] }
        if (unit) return { rows: results.buckets.map((row) => rowOf(row.key, null)) }

        const keys = [...new Set([...spent.keys(), ...done.keys(), ...linked.keys()])]
        const userIds = query.groupBy === "member" ? keys.filter(Predicate.isNotNull) : []
        const names = new Map(
          userIds.length === 0
            ? []
            : (yield* database.db
                .select({ id: users.id, name: users.name })
                .from(users)
                .where(inArray(users.id, userIds))
                .pipe(Effect.orDie)).map((row) => [row.id, row.name] as const),
        )
        return {
          rows: keys
            .map((key) => rowOf(key, (key && names.get(key)) ?? null))
            .toSorted(orderOf(query.orderBy))
            .slice(0, query.limit),
        }
      }),
    })
  }),
)
