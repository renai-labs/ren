import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Insights as InsightsSchema } from "@ren/schema/insights"
import { Models } from "@ren/schema/models"
import type { Space } from "@ren/schema/space"
import type { Usage } from "@ren/schema/usage"
import { TaskLink } from "@ren/schema/task-link"
import { and, eq } from "drizzle-orm"
import { DateTime, Effect } from "effect"
import { Insights } from "../src/insights.js"
import { Task } from "../src/task.js"
import { Seed } from "./lib/seed.js"
import { TaskFixture } from "./lib/task-fixture.js"

const it = TaskFixture.harness().it

const org = TaskFixture.org

const spend = Effect.fnUntraced(function* (
  space: { readonly id: Space.ID; readonly organizationId: Auth.OrganizationID },
  time: DateTime.Utc,
  fields: Partial<typeof Database.Schema.usage_event.$inferInsert> = {},
  call: Partial<Usage.ModelCall> = {},
) {
  const database = yield* Database.Service
  yield* database.db.insert(Database.Schema.usage_event).values({
    source: "ren-inference",
    id: crypto.randomUUID(),
    type: "model.call",
    time: DateTime.toDateUtc(time),
    workload: "brain:brn_test",
    organization: space.organizationId,
    space: space.id,
    payer: "ren",
    provider: "anthropic",
    cost_micro_usd: 5000,
    data: {
      requested_model: "claude-sonnet-4-5",
      served_model: "anthropic/claude-sonnet-4-5",
      input_tokens: 1000,
      output_tokens: 100,
      ...call,
    },
    ...fields,
  })
})

const memberOf = Effect.fnUntraced(function* (userId: Auth.UserID) {
  const database = yield* Database.Service
  const row = (yield* database.db
    .select({ id: Database.Schema.member.id })
    .from(Database.Schema.member)
    .where(eq(Database.Schema.member.userId, userId))).at(0)
  if (!row) return yield* Effect.die(new Error(`${userId} has no member row`))
  return row.id
})

const query = (
  spaceId: Space.ID,
  from: DateTime.Utc,
  to: DateTime.Utc,
  fields: Partial<InsightsSchema.Query> = {},
) => ({
  spaceId,
  from,
  to,
  timezone: "UTC",
  groupBy: "none" as const,
  orderBy: "cost" as const,
  limit: 50,
  ...fields,
})

const utc = (iso: string) => DateTime.makeUnsafe(iso)

describe("Insights", () => {
  it.live("adds up the usage of one space in the range, without other spaces or other times", () =>
    Effect.gen(function* () {
      const insights = yield* Insights.Service
      const o = yield* org
      const from = utc("2026-10-01T00:00:00Z")
      const to = utc("2026-10-08T00:00:00Z")
      yield* spend(o.factory, from, { root_session: "ses_a" }, { cache_write_tokens: 10, cache_write_1h_tokens: 5 })
      yield* spend(o.factory, utc("2026-10-02T00:00:00Z"), { root_session: "ses_a", payer: "customer" })
      yield* spend(o.factory, utc("2026-10-03T00:00:00Z"), {
        root_session: "ses_b",
        cost_micro_usd: null,
        error: { message: "overloaded" },
      })
      yield* spend(o.eng, utc("2026-10-02T00:00:00Z"))
      yield* spend(o.factory, utc("2026-09-30T23:59:59Z"))
      yield* spend(o.factory, to)

      expect(yield* insights.query(o.ada, query(o.factory.id, from, to))).toEqual({
        rows: [
          {
            key: null,
            label: null,
            sessions: 2,
            calls: 3,
            errors: 1,
            tokens: { input: 3000, output: 300, reasoning: 0, cacheRead: 0, cacheWrite: 15 },
            cost: { ren: 5000, customer: 5000, unpricedCalls: 1 },
            tasksDone: 0,
            prsMerged: 0,
            prsLinked: 0,
          },
        ],
      })
    }).pipe(Effect.provide(Insights.layer)),
  )

  it.live("a sandbox run adds its cost to the space, as its own provider, with no calls, sessions or tokens", () =>
    Effect.gen(function* () {
      const insights = yield* Insights.Service
      const o = yield* org
      const from = utc("2026-10-01T00:00:00Z")
      const to = utc("2026-10-02T00:00:00Z")
      yield* spend(o.factory, from, { root_session: "ses_a" })
      yield* spend(o.factory, from, {
        source: "e2b",
        type: "sandbox.compute",
        provider: "e2b",
        cost_micro_usd: 269_064,
        data: { sandbox_id: "sbx_1", duration_ms: 1_818_000, vcpu_ms: 14_544_000, memory_mib_ms: 14_893_056_000 },
      })

      const total = yield* insights.query(o.ada, query(o.factory.id, from, to))
      expect(total.rows.map((row) => [row.sessions, row.calls, row.tokens.input, row.cost.ren])).toEqual([
        [1, 1, 1000, 274_064],
      ])
      const byProvider = yield* insights.query(o.ada, query(o.factory.id, from, to, { groupBy: "provider" }))
      expect(byProvider.rows.map((row) => [row.key, row.calls, row.cost.ren])).toEqual([
        ["e2b", 0, 269_064],
        ["anthropic", 1, 5000],
      ])
    }).pipe(Effect.provide(Insights.layer)),
  )

  it.live("a person who cannot see the space gets NotFound", () =>
    Effect.gen(function* () {
      const insights = yield* Insights.Service
      const o = yield* org
      const now = yield* DateTime.now
      const error = yield* insights
        .query(o.grace, query(o.factory.id, now, DateTime.add(now, { hours: 1 })))
        .pipe(Effect.flip)
      expect(error._tag).toBe("Primitive.NotFound")
    }).pipe(Effect.provide(Insights.layer)),
  )

  it.live("day buckets follow the time zone, and a day with no data is a row of zeros", () =>
    Effect.gen(function* () {
      const insights = yield* Insights.Service
      const o = yield* org
      yield* spend(o.factory, utc("2026-10-01T20:00:00Z"))

      const result = yield* insights.query(
        o.ada,
        query(o.factory.id, utc("2026-09-30T18:30:00Z"), utc("2026-10-03T18:30:00Z"), {
          groupBy: "day",
          timezone: "Asia/Kolkata",
        }),
      )
      expect(result.rows.map((row) => [row.key, row.calls])).toEqual([
        ["2026-09-30T18:30:00.000Z", 0],
        ["2026-10-01T18:30:00.000Z", 1],
        ["2026-10-02T18:30:00.000Z", 0],
      ])
    }).pipe(Effect.provide(Insights.layer)),
  )

  it.live("a member sent as a placeholder groups with the same member sent as an ID", () =>
    Effect.gen(function* () {
      const insights = yield* Insights.Service
      const o = yield* org
      const from = utc("2026-10-01T00:00:00Z")
      const memberId = yield* memberOf(o.ada.userId)
      yield* spend(o.factory, from, { member: memberId })
      yield* spend(o.factory, from, { member: Models.personPlaceholder(memberId) })
      yield* spend(o.factory, from, {}, { kind: "title" })

      const result = yield* insights.query(
        o.ada,
        query(o.factory.id, from, utc("2026-10-02T00:00:00Z"), { groupBy: "member" }),
      )
      expect(result.rows.map((row) => [row.key, row.label, row.calls])).toEqual([
        [o.ada.userId, "Ada", 2],
        [null, null, 1],
      ])
      const filtered = yield* insights.query(
        o.ada,
        query(o.factory.id, from, utc("2026-10-02T00:00:00Z"), { userId: [o.ada.userId] }),
      )
      expect(filtered.rows.map((row) => row.calls)).toEqual([2])
    }).pipe(Effect.provide(Insights.layer)),
  )

  it.live("a task counts once, at its latest move to done, in its space and with its owner now", () =>
    Effect.gen(function* () {
      const insights = yield* Insights.Service
      const tasks = yield* Task.Service
      const o = yield* org
      const now = yield* DateTime.now
      const range = { from: DateTime.subtract(now, { hours: 1 }), to: DateTime.add(now, { hours: 1 }) }
      const twice = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Done twice" })
      yield* tasks.update(o.ada, twice.id, { status: "done" })
      yield* tasks.update(o.ada, twice.id, { status: "in_progress" })
      yield* tasks.update(o.ada, twice.id, { status: "done" })
      const reopened = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Reopened" })
      yield* tasks.update(o.ada, reopened.id, { status: "done" })
      yield* tasks.update(o.ada, reopened.id, { status: "todo" })
      const moved = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Moved" })
      yield* tasks.update(o.ada, moved.id, { status: "done" })
      yield* Seed.join(o.eng.id, o.ada.userId)
      yield* tasks.assign(o.ada, moved.id, { spaceId: o.eng.id, ownerId: o.ada.userId, start: "none" })
      const owned = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Owned" })
      yield* tasks.assign(o.ada, owned.id, { ownerId: o.ada.userId, start: "none" })
      yield* tasks.update(o.ada, owned.id, { status: "done" })

      const factory = yield* insights.query(o.ada, query(o.factory.id, range.from, range.to))
      expect(factory.rows.map((row) => row.tasksDone)).toEqual([2])
      const eng = yield* insights.query(o.ada, query(o.eng.id, range.from, range.to))
      expect(eng.rows.map((row) => row.tasksDone)).toEqual([1])
      const byOwner = yield* insights.query(o.ada, query(o.factory.id, range.from, range.to, { groupBy: "member" }))
      expect(byOwner.rows.map((row) => [row.key, row.tasksDone])).toEqual([
        [o.ada.userId, 1],
        [null, 1],
      ])
      const byModel = yield* insights.query(o.ada, query(o.factory.id, range.from, range.to, { groupBy: "model" }))
      expect(byModel.rows).toEqual([])
    }).pipe(Effect.provide(Insights.layer)),
  )

  it.live("a task done on two days counts only on the later day", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const insights = yield* Insights.Service
      const tasks = yield* Task.Service
      const o = yield* org
      const today = DateTime.startOf(yield* DateTime.now, "day")
      const task = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Done twice" })
      yield* tasks.update(o.ada, task.id, { status: "done" })
      const first = (yield* database.db
        .select({ id: Database.Schema.task_event.id })
        .from(Database.Schema.task_event)
        .where(and(eq(Database.Schema.task_event.task_id, task.id), eq(Database.Schema.task_event.kind, "status")))).at(
        0,
      )
      if (!first) return yield* Effect.die(new Error("The task has no status event"))
      yield* database.db
        .update(Database.Schema.task_event)
        .set({ created_at: DateTime.toDateUtc(DateTime.subtract(today, { hours: 12 })) })
        .where(eq(Database.Schema.task_event.id, first.id))
      yield* tasks.update(o.ada, task.id, { status: "in_progress" })
      yield* tasks.update(o.ada, task.id, { status: "done" })

      const result = yield* insights.query(
        o.ada,
        query(o.factory.id, DateTime.subtract(today, { days: 1 }), DateTime.add(today, { days: 1 }), {
          groupBy: "day",
        }),
      )
      expect(result.rows.map((row) => row.tasksDone)).toEqual([0, 1])
    }).pipe(Effect.provide(Insights.layer)),
  )

  it.live("counts each pull request once, linked and merged, across the tasks that link it", () =>
    Effect.gen(function* () {
      const insights = yield* Insights.Service
      const tasks = yield* Task.Service
      const o = yield* org
      const now = yield* DateTime.now
      const url = "https://github.com/acme/web/pull/7"
      const first = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "API", links: [url] })
      yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "UI", links: [url] })
      yield* tasks.update(o.ada, first.id, { addLinks: ["https://github.com/acme/web/pull/8"] })
      yield* tasks.completeMerged(o.organizationId, TaskLink.classify(url), url)

      const result = yield* insights.query(
        o.ada,
        query(o.factory.id, DateTime.subtract(now, { hours: 1 }), DateTime.add(now, { hours: 1 })),
      )
      expect(result.rows.map((row) => [row.tasksDone, row.prsMerged, row.prsLinked])).toEqual([[2, 1, 2]])
    }).pipe(Effect.provide(Insights.layer)),
  )
})
