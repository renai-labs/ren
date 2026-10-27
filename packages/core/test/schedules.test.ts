import { describe, expect, test } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Schedule } from "@ren/schema/schedule"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { ScheduleRun } from "@ren/schema/schedule-run"
import { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { and, eq } from "drizzle-orm"
import { Context, Cron, DateTime, Effect, Layer, Option, Queue, Schema } from "effect"
import { Access } from "../src/access.js"
import type { Actor } from "../src/actor.js"
import { BrainHost } from "../src/brain-host.js"
import { Brains } from "../src/brains.js"
import { DurableRunner } from "../src/durable-runner.js"
import { ScheduleTime } from "../src/schedule/time.js"
import { ScheduleTrigger } from "../src/schedule-trigger.js"
import { ScheduleRuns } from "../src/schedule/runs.js"
import { Schedules } from "../src/schedules.js"
import { SessionRunner } from "../src/session/runner.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

type Call =
  | {
      readonly kind: "create"
      readonly owner: SessionRunner.Owner
      readonly input: Session.StartInput
      readonly agentId?: string
    }
  | { readonly kind: "send"; readonly input: Session.SendInput }

// oxlint-disable-next-line ren/no-comments -- The chats that runs start or send to: SessionRunner is the edge of schedules, and the brain behind it has its own suites.
class Chats extends Context.Service<
  Chats,
  {
    readonly calls: Queue.Queue<Call>
    readonly busy: Set<Session.ID>
    readonly refuse: { value: boolean }
    readonly rejected: Array<(sessionId: Session.ID) => Effect.Effect<void>>
  }
>()("@ren/core/test/Schedules/Chats") {}

const chats = Layer.effect(
  Chats,
  Effect.map(Queue.unbounded<Call>(), (calls) =>
    Chats.of({ calls, busy: new Set(), refuse: { value: false }, rejected: [] }),
  ),
)

const runner = Layer.effect(
  SessionRunner.Service,
  Effect.gen(function* () {
    const recorded = yield* Chats
    const created = new Set<Session.ID>()
    const owner = {
      organizationId: Auth.OrganizationID.create(),
      spaceId: Space.ID.create(),
      createdBy: Auth.UserID.create(),
    }
    const unavailable = new BrainHost.BrainUnavailable({ cause: new Error("The brain is starting") })
    const rejected = new Brains.BrainRejectedError({ message: "The brain is starting." })
    return SessionRunner.Service.of({
      create: (owner, input, options) =>
        Effect.gen(function* () {
          yield* Queue.offer(recorded.calls, {
            kind: "create",
            owner,
            input,
            ...(options?.agentId && { agentId: options.agentId }),
          })
          if (recorded.refuse.value) return yield* rejected
          if (created.has(input.sessionId)) return yield* new SessionRunner.AlreadyExists({ message: "exists" })
          created.add(input.sessionId)
        }),
      send: (input) =>
        Effect.gen(function* () {
          yield* Queue.offer(recorded.calls, { kind: "send", input })
          if (recorded.refuse.value) return yield* unavailable
          return { messageId: input.messageId }
        }),
      get: (sessionId) =>
        created.has(sessionId) || recorded.busy.has(sessionId)
          ? Effect.succeed({
              id: sessionId,
              rootId: sessionId,
              organizationId: owner.organizationId,
              spaceId: owner.spaceId,
              createdBy: owner.createdBy,
              brainId: Brain.ofSession(sessionId),
              parentId: null,
              harness: "opencode",
              title: null,
              status: recorded.busy.has(sessionId) ? "busy" : "idle",
              outcome: null,
              createdAt: DateTime.makeUnsafe(0),
              updatedAt: null,
            })
          : Effect.fail(new SessionRunner.NotFound({ message: "Session not found." })),
      onStartRejected: (listener) => Effect.sync(() => void recorded.rejected.push(listener)),
    })
  }),
)

const it = testEffect(
  Schedules.layer.pipe(
    Layer.provideMerge(ScheduleTrigger.layerPostgres),
    Layer.provideMerge(runner),
    Layer.provideMerge(chats),
    Layer.provideMerge(Layer.mergeAll(Access.layer, DurableRunner.layerMemory)),
    Layer.provideMerge(Testing.layer),
  ),
)

const decodeCreate = Schema.decodeUnknownSync(Schedule.CreateInput)

const daily = { cron: "0 9 * * *", timeZone: "Europe/Berlin" }

const hourly = { cron: "0 * * * *", timeZone: "UTC" }

const runsOf = (scheduleId: Schedule.ID) =>
  Effect.flatMap(Database.Service, (database) =>
    database.db
      .select()
      .from(Database.Schema.schedule_run)
      .where(eq(Database.Schema.schedule_run.schedule_id, scheduleId)),
  )

const rowOf = (scheduleId: Schedule.ID) =>
  Effect.flatMap(Database.Service, (database) =>
    database.db.select().from(Database.Schema.schedule).where(eq(Database.Schema.schedule.id, scheduleId)),
  ).pipe(
    Effect.flatMap((rows) => {
      const row = rows.at(0)
      return row ? Effect.succeed(row) : Effect.die(new Error("The schedule has no row"))
    }),
  )

// oxlint-disable-next-line ren/no-comments -- A run settles on its durable run; the test reads the run rows until none is pending.
const settled = (scheduleId: Schedule.ID, count = 1) => {
  const read: ReturnType<typeof runsOf> = runsOf(scheduleId).pipe(
    Effect.flatMap((rows) =>
      rows.length >= count && rows.every((row) => row.status !== "pending")
        ? Effect.succeed(rows)
        : Effect.sleep("20 millis").pipe(Effect.andThen(Effect.suspend(() => read))),
    ),
  )
  return read.pipe(Effect.timeout("5 seconds"))
}

const due = (scheduleId: Schedule.ID, at: Date) =>
  Effect.flatMap(Database.Service, (database) =>
    database.db
      .update(Database.Schema.schedule)
      .set({ next_run_at: at })
      .where(eq(Database.Schema.schedule.id, scheduleId)),
  )

const team = Effect.gen(function* () {
  const owner = yield* Seed.owner()
  const ada: Actor.Info = { userId: owner.createdBy, organizationId: owner.organizationId, roles: ["owner"] }
  const bob = yield* Seed.actor(owner.organizationId, "member")
  yield* Seed.join(owner.spaceId, bob.userId)
  return { ...owner, ada, bob }
})

describe("Schedules", () => {
  it.live(
    "a due daily schedule starts one non-interactive chat as its owner, with the schedule's agent, title and origin, and moves to the next day (S1, S7, S8, S12, S13, S22)",
    () =>
      Effect.gen(function* () {
        const schedules = yield* Schedules.Service
        const recorded = yield* Chats
        const t = yield* team
        const agentId = yield* Seed.agent(t, "reporter", { isSubagent: false })
        const created = yield* schedules.create(
          t.ada,
          decodeCreate({ spaceId: t.spaceId, name: "Daily report", message: "Post the report.", when: daily, agentId }),
        )
        const cron = Cron.parseUnsafe(daily.cron, daily.timeZone)
        const upcoming = Cron.next(cron, new Date())
        expect(created).toMatchObject({ status: "active", ownerId: t.createdBy, target: "new-chat", agentId })
        expect(created.nextRunAt && DateTime.toEpochMillis(created.nextRunAt)).toBe(upcoming.getTime())
        const fire = Cron.prev(cron, new Date())
        yield* due(created.id, fire)
        yield* schedules.tick
        const call = yield* Queue.take(recorded.calls)
        const runs = yield* settled(created.id)
        expect(runs).toMatchObject([{ status: "started", trigger: "timed", scheduled_at: fire }])
        const title = `Daily report · ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Berlin" }).format(fire)}`
        expect(call).toMatchObject({
          kind: "create",
          owner: { organizationId: t.organizationId, spaceId: t.spaceId, createdBy: t.createdBy },
          agentId,
          input: {
            sessionId: runs.at(0)?.session_id,
            title,
            interactive: false,
            initialMessage: {
              messageId: runs.at(0)?.message_id,
              prompt: { text: "Post the report." },
              sender: { userId: t.createdBy, memberId: t.memberId },
              schedule: { scheduleId: created.id, name: "Daily report", scheduledAt: fire.toISOString() },
            },
          },
        })
        expect((yield* rowOf(created.id)).next_run_at).toEqual(upcoming)
      }),
  )

  it.live("two ticks at once insert one run and start one chat (S1)", () =>
    Effect.gen(function* () {
      const schedules = yield* Schedules.Service
      const recorded = yield* Chats
      const t = yield* team
      const created = yield* schedules.create(
        t.ada,
        decodeCreate({ spaceId: t.spaceId, name: "Digest", message: "Digest.", when: hourly }),
      )
      yield* due(created.id, Cron.prev(Cron.parseUnsafe(hourly.cron, hourly.timeZone), new Date()))
      yield* Effect.all([schedules.tick, schedules.tick], { concurrency: 2 })
      expect(yield* settled(created.id)).toHaveLength(1)
      expect(yield* Queue.size(recorded.calls)).toBe(1)
    }),
  )

  it.live("a pending run whose durable run was never stored starts at the next tick (S1)", () =>
    Effect.gen(function* () {
      const schedules = yield* Schedules.Service
      const database = yield* Database.Service
      const recorded = yield* Chats
      const t = yield* team
      const created = yield* schedules.create(
        t.ada,
        decodeCreate({ spaceId: t.spaceId, name: "Digest", message: "Digest.", when: hourly }),
      )
      const sessionId = Session.ID.create()
      yield* database.db.insert(Database.Schema.schedule_run).values({
        id: ScheduleRun.ID.create(),
        schedule_id: created.id,
        scheduled_at: new Date(Date.now() - 60_000),
        trigger: "timed",
        session_id: sessionId,
        message_id: Session.MessageID.create(),
      })
      yield* schedules.tick
      expect(yield* Queue.take(recorded.calls)).toMatchObject({ kind: "create", input: { sessionId } })
      expect(yield* settled(created.id)).toMatchObject([{ status: "started" }])
    }),
  )

  it.live("after an outage only the latest missed fire runs, and the next fire is in the future (S2, S17)", () =>
    Effect.gen(function* () {
      const schedules = yield* Schedules.Service
      const t = yield* team
      const created = yield* schedules.create(
        t.ada,
        decodeCreate({ spaceId: t.spaceId, name: "Digest", message: "Digest.", when: hourly }),
      )
      const cron = Cron.parseUnsafe(hourly.cron, hourly.timeZone)
      const latest = Cron.prev(cron, new Date())
      yield* due(created.id, new Date(latest.getTime() - 3 * 3_600_000))
      yield* schedules.tick
      expect(yield* settled(created.id)).toMatchObject([{ status: "started", scheduled_at: latest }])
      expect((yield* rowOf(created.id)).next_run_at).toEqual(Cron.next(cron, new Date()))
    }),
  )

  it.live("a fire is skipped while the previous run's chat works (S3)", () =>
    Effect.gen(function* () {
      const schedules = yield* Schedules.Service
      const recorded = yield* Chats
      const t = yield* team
      const created = yield* schedules.create(
        t.ada,
        decodeCreate({ spaceId: t.spaceId, name: "Digest", message: "Digest.", when: hourly }),
      )
      const latest = Cron.prev(Cron.parseUnsafe(hourly.cron, hourly.timeZone), new Date())
      const earlier = new Date(latest.getTime() - 3_600_000)
      yield* due(created.id, earlier)
      yield* Effect.flatMap(Database.Service, (database) =>
        database.db
          .update(Database.Schema.schedule)
          .set({ until_at: new Date(earlier.getTime() + 1000) })
          .where(eq(Database.Schema.schedule.id, created.id)),
      )
      yield* schedules.tick
      const first = yield* Queue.take(recorded.calls)
      if (first.kind !== "create") return yield* Effect.die(new Error("The first run sent to a chat"))
      recorded.busy.add(first.input.sessionId)
      yield* settled(created.id)
      yield* Effect.flatMap(Database.Service, (database) =>
        database.db
          .update(Database.Schema.schedule)
          .set({ until_at: null, next_run_at: latest })
          .where(eq(Database.Schema.schedule.id, created.id)),
      )
      yield* schedules.tick
      expect(yield* settled(created.id, 2)).toMatchObject([
        { status: "started", scheduled_at: earlier },
        { status: "skipped", reason: "previous_run_busy", scheduled_at: latest },
      ])
    }),
  )

  it.live(
    "an agent's follow-up in 30 minutes targets its root chat and arrives there queued, then the schedule ends (S4, S6, S20)",
    () =>
      Effect.gen(function* () {
        const schedules = yield* Schedules.Service
        const recorded = yield* Chats
        const t = yield* team
        const agentId = yield* Seed.agent(t, "build", { isSubagent: false })
        const sessionId = yield* Seed.session({
          organizationId: t.organizationId,
          spaceId: t.spaceId,
          createdBy: t.createdBy,
        })
        const agent = { ...t.ada, agent: { agentId, sessionId, spaceId: t.spaceId, fence: null } }
        const before = Date.now()
        const created = yield* schedules.create(
          agent,
          decodeCreate({
            spaceId: t.spaceId,
            name: "CI check",
            message: "Check CI again.",
            when: { in: "30 minutes" },
            target: "this-chat",
          }),
        )
        expect(created).toMatchObject({ target: { sessionId }, ownerId: t.createdBy, status: "active" })
        const at = "at" in created.when ? DateTime.toEpochMillis(created.when.at) : 0
        expect(at - before).toBeGreaterThanOrEqual(30 * 60_000)
        expect(at - before).toBeLessThan(31 * 60_000)
        yield* due(created.id, new Date(Date.now() - 1000))
        yield* Effect.flatMap(Database.Service, (database) =>
          database.db
            .update(Database.Schema.schedule)
            .set({ run_at: new Date(Date.now() - 1000) })
            .where(eq(Database.Schema.schedule.id, created.id)),
        )
        yield* schedules.tick
        const runs = yield* settled(created.id)
        expect(yield* Queue.take(recorded.calls)).toMatchObject({
          kind: "send",
          input: {
            sessionId,
            messageId: runs.at(0)?.message_id,
            delivery: "queue",
            prompt: { text: "Check CI again." },
            schedule: { scheduleId: created.id, name: "CI check" },
          },
        })
        expect(runs).toMatchObject([{ status: "started", session_id: sessionId }])
        expect(yield* schedules.get(t.ada, created.id)).toMatchObject({ status: "ended", nextRunAt: null })
      }),
  )

  it.live(
    "a person's this-chat, a past time, a past end, fires less than 5 minutes apart and a cron that never matches are refused (S5, S20, S33)",
    () =>
      Effect.gen(function* () {
        const schedules = yield* Schedules.Service
        const t = yield* team
        const base = { spaceId: t.spaceId, name: "Bad", message: "Bad." }
        const thisChat = yield* schedules
          .create(t.ada, decodeCreate({ ...base, when: daily, target: "this-chat" }))
          .pipe(Effect.flip)
        const past = yield* schedules
          .create(t.ada, decodeCreate({ ...base, when: { at: DateTime.makeUnsafe("2020-01-01T00:00:00Z") } }))
          .pipe(Effect.flip)
        const ended = yield* schedules
          .create(
            t.ada,
            decodeCreate({ ...base, when: { ...daily, until: DateTime.makeUnsafe("2020-01-01T00:00:00Z") } }),
          )
          .pipe(Effect.flip)
        const often = yield* schedules
          .create(t.ada, decodeCreate({ ...base, when: { cron: "0,2 9 * * *", timeZone: "UTC" } }))
          .pipe(Effect.flip)
        const never = yield* schedules
          .create(t.ada, decodeCreate({ ...base, when: { cron: "0 0 30 2 *", timeZone: "UTC" } }))
          .pipe(Effect.flip)
        expect(
          [thisChat, past, ended, often, never].map((error) => [error._tag, "field" in error && error.field]),
        ).toEqual([
          ["Primitive.Invalid", "target"],
          ["Primitive.Invalid", "when"],
          ["Primitive.Invalid", "when"],
          ["Primitive.Invalid", "when"],
          ["Primitive.Invalid", "when"],
        ])
      }),
  )

  it.live(
    "a schedule takes a slug from its name, unique among the live schedules of its space, and keeps it when renamed",
    () =>
      Effect.gen(function* () {
        const schedules = yield* Schedules.Service
        const t = yield* team
        const create = (spaceId: Space.ID, input: { readonly name: string; readonly slug?: string }) =>
          schedules.create(t.ada, decodeCreate({ spaceId, ...input, message: "Digest.", when: daily }))
        const first = yield* create(t.spaceId, { name: "Daily digest" })
        const second = yield* create(t.spaceId, { name: "Daily digest" })
        expect([first.slug, second.slug]).toEqual(["daily-digest", "daily-digest-2"])
        expect((yield* create(t.spaceId, { name: "Digest", slug: "morning" })).slug).toBe("morning")
        const taken = yield* Effect.flip(create(t.spaceId, { name: "Digest", slug: "daily-digest" }))
        expect(taken).toMatchObject({
          _tag: "Primitive.Conflict",
          message: "The slug “daily-digest” is already taken.",
        })
        expect((yield* schedules.update(t.ada, first.id, { name: "Morning digest" })).slug).toBe("daily-digest")
        yield* schedules.archive(t.ada, second.id)
        expect((yield* create(t.spaceId, { name: "Daily digest" })).slug).toBe("daily-digest-2")
        const other = yield* Seed.space(t.organizationId)
        yield* Seed.join(other, t.createdBy)
        expect((yield* create(other, { name: "Daily digest" })).slug).toBe("daily-digest")
      }),
  )

  it.live(
    "a member who changes the message becomes the owner, a pause and a resume keep the owner, and a non-member sees nothing (S9)",
    () =>
      Effect.gen(function* () {
        const schedules = yield* Schedules.Service
        const t = yield* team
        const created = yield* schedules.create(
          t.ada,
          decodeCreate({ spaceId: t.spaceId, name: "Digest", message: "Digest.", when: daily }),
        )
        const renamed = yield* schedules.update(t.bob, created.id, { name: "Morning digest" })
        expect(renamed.ownerId).toBe(t.createdBy)
        const edited = yield* schedules.update(t.bob, created.id, { message: "Digest, in French." })
        expect(edited.ownerId).toBe(t.bob.userId)
        const paused = yield* schedules.pause(t.ada, created.id, {})
        expect(paused).toMatchObject({ status: "paused", pausedReason: "user", nextRunAt: null, ownerId: t.bob.userId })
        const resumed = yield* schedules.resume(t.ada, created.id, {})
        expect(resumed).toMatchObject({ status: "active", pausedReason: null, ownerId: t.bob.userId })
        const stranger = yield* Seed.actor(t.organizationId, "admin")
        expect((yield* schedules.get(stranger, created.id).pipe(Effect.flip))._tag).toBe("Primitive.NotFound")
        expect((yield* schedules.list(stranger, { page: 1, pageSize: 50 })).items).toEqual([])
      }),
  )

  it.live(
    "a fire after the owner left pauses the schedule, and the member who resumes it becomes the owner (S10)",
    () =>
      Effect.gen(function* () {
        const schedules = yield* Schedules.Service
        const database = yield* Database.Service
        const t = yield* team
        const created = yield* schedules.create(
          t.bob,
          decodeCreate({ spaceId: t.spaceId, name: "Digest", message: "Digest.", when: hourly }),
        )
        yield* database.db
          .update(Database.Schema.space_member)
          .set({ archived_at: new Date() })
          .where(
            and(
              eq(Database.Schema.space_member.space_id, t.spaceId),
              eq(Database.Schema.space_member.user_id, t.bob.userId),
            ),
          )
        yield* due(created.id, Cron.prev(Cron.parseUnsafe(hourly.cron, hourly.timeZone), new Date()))
        yield* schedules.tick
        expect(yield* settled(created.id)).toMatchObject([{ status: "skipped", reason: "owner_left" }])
        expect(yield* schedules.get(t.ada, created.id)).toMatchObject({ status: "paused", pausedReason: "owner_left" })
        expect(yield* schedules.resume(t.ada, created.id, {})).toMatchObject({ status: "active", ownerId: t.createdBy })
      }),
  )

  it.live("a fire after its agent was archived pauses the schedule, and it resumes only with another agent (S11)", () =>
    Effect.gen(function* () {
      const schedules = yield* Schedules.Service
      const database = yield* Database.Service
      const t = yield* team
      const agentId = yield* Seed.agent(t, "reporter", { isSubagent: false })
      const created = yield* schedules.create(
        t.ada,
        decodeCreate({ spaceId: t.spaceId, name: "Digest", message: "Digest.", when: hourly, agentId }),
      )
      yield* database.db
        .update(Database.Schema.agent)
        .set({ archived_at: new Date() })
        .where(eq(Database.Schema.agent.id, agentId))
      yield* due(created.id, Cron.prev(Cron.parseUnsafe(hourly.cron, hourly.timeZone), new Date()))
      yield* schedules.tick
      expect(yield* settled(created.id)).toMatchObject([{ status: "skipped", reason: "agent_removed" }])
      expect((yield* schedules.resume(t.ada, created.id, {}).pipe(Effect.flip))._tag).toBe("Primitive.Conflict")
      yield* schedules.update(t.ada, created.id, { agentId: null })
      expect(yield* schedules.resume(t.ada, created.id, {})).toMatchObject({ status: "active", agentId: null })
    }),
  )

  it.live("a run that the brain keeps refusing fails once its retry time is over (S15)", () =>
    Effect.gen(function* () {
      const schedules = yield* Schedules.Service
      const recorded = yield* Chats
      const t = yield* team
      recorded.refuse.value = true
      const created = yield* schedules.create(
        t.ada,
        decodeCreate({ spaceId: t.spaceId, name: "Digest", message: "Digest.", when: hourly }),
      )
      yield* due(created.id, Cron.prev(Cron.parseUnsafe(hourly.cron, hourly.timeZone), new Date()))
      yield* schedules.tick
      yield* Queue.take(recorded.calls)
      const old = new Date(Date.now() - 3 * 3_600_000)
      yield* Effect.flatMap(Database.Service, (database) =>
        database.db
          .update(Database.Schema.schedule_run)
          .set({ scheduled_at: old, created_at: old })
          .where(eq(Database.Schema.schedule_run.schedule_id, created.id)),
      )
      expect(yield* settled(created.id)).toMatchObject([{ status: "failed", error: "The brain is starting." }])
    }),
  )

  it.live("run now starts a chat for a paused schedule whose last chat still works (S16)", () =>
    Effect.gen(function* () {
      const schedules = yield* Schedules.Service
      const recorded = yield* Chats
      const t = yield* team
      const created = yield* schedules.create(
        t.ada,
        decodeCreate({ spaceId: t.spaceId, name: "Digest", message: "Digest.", when: hourly }),
      )
      yield* schedules.run(t.ada, created.id, {})
      const first = yield* Queue.take(recorded.calls)
      if (first.kind !== "create") return yield* Effect.die(new Error("Run now sent to a chat"))
      recorded.busy.add(first.input.sessionId)
      yield* settled(created.id)
      yield* schedules.pause(t.ada, created.id, {})
      yield* schedules.run(t.ada, created.id, {})
      expect(yield* Queue.take(recorded.calls)).toMatchObject({ kind: "create" })
      expect(yield* settled(created.id, 2)).toMatchObject([
        { status: "started", trigger: "manual" },
        { status: "started", trigger: "manual" },
      ])
    }),
  )

  it.live("a run claimed before a pause is skipped as paused (S27)", () =>
    Effect.gen(function* () {
      const schedules = yield* Schedules.Service
      const database = yield* Database.Service
      const t = yield* team
      const created = yield* schedules.create(
        t.ada,
        decodeCreate({ spaceId: t.spaceId, name: "Digest", message: "Digest.", when: hourly }),
      )
      yield* schedules.pause(t.ada, created.id, {})
      yield* database.db.insert(Database.Schema.schedule_run).values({
        id: ScheduleRun.ID.create(),
        schedule_id: created.id,
        scheduled_at: new Date(Date.now() - 60_000),
        trigger: "timed",
        session_id: Session.ID.create(),
        message_id: Session.MessageID.create(),
      })
      yield* schedules.tick
      expect(yield* settled(created.id)).toMatchObject([{ status: "skipped", reason: "paused" }])
    }),
  )

  it.live("a fire for an archived chat archives the schedule (S28)", () =>
    Effect.gen(function* () {
      const schedules = yield* Schedules.Service
      const database = yield* Database.Service
      const t = yield* team
      const sessionId = yield* Seed.session({
        organizationId: t.organizationId,
        spaceId: t.spaceId,
        createdBy: t.createdBy,
      })
      const created = yield* schedules.create(
        t.ada,
        decodeCreate({ spaceId: t.spaceId, name: "Ping", message: "Ping.", when: hourly, target: { sessionId } }),
      )
      yield* database.db
        .update(Database.Schema.agent_session)
        .set({ archived_at: new Date() })
        .where(eq(Database.Schema.agent_session.id, sessionId))
      yield* due(created.id, Cron.prev(Cron.parseUnsafe(hourly.cron, hourly.timeZone), new Date()))
      yield* schedules.tick
      expect(yield* settled(created.id)).toMatchObject([{ status: "skipped", reason: "chat_archived" }])
      expect((yield* rowOf(created.id)).archived_at).not.toBeNull()
    }),
  )

  it.live(
    "a start that the brain refuses later fails its run, and the fifth failure in a row pauses the schedule (S32, S36)",
    () =>
      Effect.gen(function* () {
        const schedules = yield* Schedules.Service
        const database = yield* Database.Service
        const recorded = yield* Chats
        const t = yield* team
        const created = yield* schedules.create(
          t.ada,
          decodeCreate({ spaceId: t.spaceId, name: "Digest", message: "Digest.", when: hourly }),
        )
        yield* database.db.insert(Database.Schema.schedule_run).values(
          [5, 4, 3, 2].map((hours) => ({
            id: ScheduleRun.ID.create(),
            schedule_id: created.id,
            scheduled_at: new Date(Date.now() - hours * 3_600_000),
            trigger: "timed" as const,
            status: "failed" as const,
            error: "The brain is starting.",
            session_id: Session.ID.create(),
            message_id: Session.MessageID.create(),
          })),
        )
        yield* schedules.run(t.ada, created.id, {})
        const call = yield* Queue.take(recorded.calls)
        if (call.kind !== "create") return yield* Effect.die(new Error("Run now sent to a chat"))
        yield* settled(created.id, 5)
        yield* Effect.forEach(recorded.rejected, (listener) => listener(call.input.sessionId), { discard: true })
        const runs = yield* runsOf(created.id)
        expect(runs.find((row) => row.session_id === call.input.sessionId)).toMatchObject({
          status: "failed",
          error: "The brain refused to start the chat.",
        })
        expect(yield* schedules.get(t.ada, created.id)).toMatchObject({ status: "paused", pausedReason: "failing" })
      }),
  )

  it.live("a run still pending 5 minutes past its deadline fails, so the next fire starts (S34)", () =>
    Effect.gen(function* () {
      const schedules = yield* Schedules.Service
      const database = yield* Database.Service
      const recorded = yield* Chats
      const t = yield* team
      const created = yield* schedules.create(
        t.ada,
        decodeCreate({ spaceId: t.spaceId, name: "Digest", message: "Digest.", when: hourly }),
      )
      const latest = Cron.prev(Cron.parseUnsafe(hourly.cron, hourly.timeZone), new Date())
      const lost = ScheduleRun.ID.create()
      const old = new Date(latest.getTime() - 2 * 3_600_000)
      yield* database.db.insert(Database.Schema.schedule_run).values({
        id: lost,
        schedule_id: created.id,
        scheduled_at: old,
        created_at: old,
        trigger: "timed",
        session_id: Session.ID.create(),
        message_id: Session.MessageID.create(),
      })
      yield* DurableRunner.ensure(ScheduleRuns.FireRun, { runId: lost })
      yield* Queue.take(recorded.calls)
      yield* settled(created.id)
      yield* database.db
        .update(Database.Schema.schedule_run)
        .set({ status: "pending" })
        .where(eq(Database.Schema.schedule_run.id, lost))
      yield* due(created.id, latest)
      yield* schedules.tick
      const runs = yield* settled(created.id, 2)
      expect(runs.find((row) => row.id === lost)).toMatchObject({ status: "failed", error: "The run did not finish." })
      expect(runs.find((row) => row.scheduled_at.getTime() === latest.getTime())).toMatchObject({ status: "started" })
    }),
  )

  it.live("a space holds at most 50 schedules that are not archived or ended (S35)", () =>
    Effect.gen(function* () {
      const schedules = yield* Schedules.Service
      const database = yield* Database.Service
      const t = yield* team
      yield* database.db.insert(Database.Schema.schedule).values(
        Array.from({ length: Schedule.maximumActive }, (_, index) => ({
          id: Schedule.ID.create(),
          organization_id: t.organizationId,
          space_id: t.spaceId,
          slug: `digest-${index}`,
          name: `Digest ${index}`,
          owner_id: t.createdBy,
          cron: "0 9 * * *",
          time_zone: "UTC",
          message: "Digest.",
          next_run_at: new Date(Date.now() + 3_600_000),
        })),
      )
      const refused = yield* schedules
        .create(t.ada, decodeCreate({ spaceId: t.spaceId, name: "One more", message: "More.", when: daily }))
        .pipe(Effect.flip)
      expect(refused).toMatchObject({ _tag: "Primitive.Conflict" })
    }),
  )

  it.live("a recurring schedule skips a fire while its chat works, and a one-time follow-up still queues (S37)", () =>
    Effect.gen(function* () {
      const schedules = yield* Schedules.Service
      const recorded = yield* Chats
      const t = yield* team
      const sessionId = yield* Seed.session({
        organizationId: t.organizationId,
        spaceId: t.spaceId,
        createdBy: t.createdBy,
      })
      recorded.busy.add(sessionId)
      const recurring = yield* schedules.create(
        t.ada,
        decodeCreate({ spaceId: t.spaceId, name: "Ping", message: "Ping.", when: hourly, target: { sessionId } }),
      )
      const once = yield* schedules.create(
        t.ada,
        decodeCreate({
          spaceId: t.spaceId,
          name: "Follow up",
          message: "Follow up.",
          when: { in: "30 minutes" },
          target: { sessionId },
        }),
      )
      yield* due(recurring.id, Cron.prev(Cron.parseUnsafe(hourly.cron, hourly.timeZone), new Date()))
      yield* Effect.flatMap(Database.Service, (database) =>
        database.db
          .update(Database.Schema.schedule)
          .set({ run_at: new Date(Date.now() - 1000), next_run_at: new Date(Date.now() - 1000) })
          .where(eq(Database.Schema.schedule.id, once.id)),
      )
      yield* schedules.tick
      expect(yield* settled(recurring.id)).toMatchObject([{ status: "skipped", reason: "previous_run_busy" }])
      expect(yield* settled(once.id)).toMatchObject([{ status: "started" }])
      expect(yield* Queue.take(recorded.calls)).toMatchObject({ kind: "send", input: { sessionId, delivery: "queue" } })
    }),
  )

  test("daylight saving follows Temporal: a missing local time does not run, a repeated one runs twice (S30)", () => {
    const fires = (from: string, count: number) =>
      Array.from({ length: count }).reduce<Array<Date>>((dates) => {
        const after = dates.at(-1) ?? new Date(from)
        const row = { cron: "30 2 * * *", time_zone: "Europe/Berlin", until_at: null, run_at: null }
        return [...dates, Option.getOrThrow(ScheduleTime.nextFire(row, after))]
      }, [])
    expect(
      [...fires("2026-03-28T12:00:00Z", 1), ...fires("2026-10-24T12:00:00Z", 3)].map((date) => date.toISOString()),
    ).toEqual([
      "2026-03-30T00:30:00.000Z",
      "2026-10-25T00:30:00.000Z",
      "2026-10-25T01:30:00.000Z",
      "2026-10-26T01:30:00.000Z",
    ])
  })
})
