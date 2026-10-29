export * as Schedules from "./schedules.js"

import { Database } from "@ren/db/database"
import { Schedule } from "@ren/schema/schedule"
import type { ScheduleOrigin } from "@ren/schema/schedule-origin"
import { ScheduleRun } from "@ren/schema/schedule-run"
import { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { and, count, desc, eq, ilike, isNotNull, isNull, lt, or, sql } from "drizzle-orm"
import { Cause, Clock, Context, Cron, DateTime, Duration, Effect, Layer, Option, Result, Schema } from "effect"
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { WorkflowEngine } from "effect/workflow"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { AgentQueries } from "./agent/queries.js"
import { DurableRunner } from "./durable-runner.js"
import { Primitive } from "./primitive.js"
import { SchedulePolicy } from "./schedule/policy.js"
import { ScheduleRuns } from "./schedule/runs.js"
import { ScheduleTime } from "./schedule/time.js"
import { ScheduleTrigger } from "./schedule-trigger.js"
import { SessionRunner } from "./session/runner.js"
import { SpaceQueries } from "./space/queries.js"

export type Interface = Primitive.Interface<typeof Schedule.definition> & {
  readonly runs: Primitive.Interface<typeof ScheduleRun.definition>["list"]
  // oxlint-disable-next-line ren/no-comments -- One pass of the ticker (S1); the layer runs it every 30 seconds.
  readonly tick: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Schedules") {}

export const tickEvery = Duration.seconds(30)

const stuckAfter = Duration.minutes(5)

const schedule = Database.Schema.schedule

const run = Database.Schema.schedule_run

type Row = typeof schedule.$inferSelect

type RunRow = typeof run.$inferSelect

const notFound = new Primitive.NotFound({ message: "Schedule not found." })

const isID = Schema.is(Schedule.ID)

const actions = {
  get: Primitive.action(Schedule.definition, "get"),
  create: Primitive.action(Schedule.definition, "create"),
  update: Primitive.action(Schedule.definition, "update"),
  archive: Primitive.action(Schedule.definition, "archive"),
  pause: Primitive.action(Schedule.definition, "pause"),
  resume: Primitive.action(Schedule.definition, "resume"),
  run: Primitive.action(Schedule.definition, "run"),
  runs: Primitive.action(ScheduleRun.definition, "list"),
}

// oxlint-disable-next-line ren/no-comments -- S4: a delay is stored as one time.
const storedOf = (when: Schedule.WhenInput, at: Date) => {
  if ("in" in when)
    return { cron: null, time_zone: null, until_at: null, run_at: new Date(at.getTime() + Duration.toMillis(when.in)) }
  if ("at" in when) return { cron: null, time_zone: null, until_at: null, run_at: DateTime.toDateUtc(when.at) }
  return {
    cron: when.cron.trim().split(/\s+/u).join(" "),
    time_zone: when.timeZone,
    until_at: when.until ? DateTime.toDateUtc(when.until) : null,
    run_at: null,
  }
}

const problemOf = (stored: ReturnType<typeof storedOf>, at: Date) => {
  if (stored.run_at && stored.run_at.getTime() <= at.getTime()) return "Pick a time in the future."
  if (stored.until_at && stored.until_at.getTime() <= at.getTime()) return "Pick an end time in the future."
  if (stored.cron && Result.isFailure(Cron.parse(stored.cron, "UTC")))
    return "Use a cron expression with five fields, for example “0 9 * * *”."
  if (Option.isNone(ScheduleTime.nextFire(stored, at))) return "The schedule would end before it runs."
  if (stored.cron && ScheduleTime.shortestGap(stored, at) < Duration.toMillis(Schedule.minimumInterval))
    return "Run at most every 5 minutes."
  return null
}

const statusOf = (row: Row): Schedule.Status => {
  if (row.paused_reason) return "paused"
  return row.next_run_at ? "active" : "ended"
}

const whenOf = (row: Row): Schedule.When =>
  row.run_at
    ? { at: DateTime.fromDateUnsafe(row.run_at) }
    : {
        cron: row.cron ?? "",
        timeZone: row.time_zone ?? "UTC",
        ...(row.until_at && { until: DateTime.fromDateUnsafe(row.until_at) }),
      }

const toInfo = (row: Row): Schedule.Info => ({
  id: row.id,
  spaceId: row.space_id,
  slug: row.slug,
  name: row.name,
  agentId: row.agent_id,
  when: whenOf(row),
  target: row.target_session_id ? { sessionId: row.target_session_id } : "new-chat",
  message: row.message,
  ownerId: row.owner_id,
  status: statusOf(row),
  pausedReason: row.paused_reason,
  nextRunAt: row.next_run_at && DateTime.fromDateUnsafe(row.next_run_at),
  createdAt: DateTime.fromDateUnsafe(row.created_at),
  updatedAt: DateTime.fromDateUnsafe(row.updated_at),
  archivedAt: row.archived_at && DateTime.fromDateUnsafe(row.archived_at),
})

const toRun = (row: RunRow): ScheduleRun.Info => ({
  id: row.id,
  scheduleId: row.schedule_id,
  scheduledAt: DateTime.fromDateUnsafe(row.scheduled_at),
  startedAt: row.started_at && DateTime.fromDateUnsafe(row.started_at),
  trigger: row.trigger,
  status: row.status,
  reason: row.reason,
  error: row.error,
  sessionId: row.session_id,
})

// oxlint-disable-next-line ren/no-comments -- S22: "Daily report · Oct 28, 09:00" in the schedule's time zone; a one-time schedule has none, so UTC.
const titleOf = (row: Row, scheduledAt: Date) =>
  `${row.name} · ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: row.time_zone ?? "UTC",
  }).format(scheduledAt)}${row.time_zone ? "" : " UTC"}`

const membershipOf = (actor: Actor.Info) =>
  and(
    eq(SchedulePolicy.membership.space_id, schedule.space_id),
    eq(SchedulePolicy.membership.user_id, actor.userId),
    isNull(SchedulePolicy.membership.archived_at),
    Actor.fenced(actor, SchedulePolicy.membership.space_id),
  )

const invalid = (message: string, field: string) => new Primitive.Invalid({ message, field })

const written = (rows: ReadonlyArray<Row>) => {
  const row = rows.at(0)
  return row ? Effect.succeed(toInfo(row)) : Effect.fail(notFound)
}

type Outcome =
  | { readonly status: "started" }
  | { readonly status: "skipped"; readonly reason: ScheduleRun.Reason }
  | { readonly status: "failed"; readonly error: string }

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const runner = yield* SessionRunner.Service
    const engine = yield* WorkflowEngine.WorkflowEngine
    const trigger = yield* ScheduleTrigger.Service

    const now = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis))

    const visibleTo = (actor: Actor.Info) =>
      and(
        eq(schedule.organization_id, actor.organizationId),
        isNull(schedule.archived_at),
        Access.where(access.plan(actor, actions.get), SchedulePolicy.where),
      )

    const find = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      id: Schedule.ID,
      action: string,
    ) {
      const found = (yield* transaction
        .select({ schedule, membershipId: SchedulePolicy.membership.id })
        .from(schedule)
        .leftJoin(SchedulePolicy.membership, membershipOf(actor))
        .where(and(eq(schedule.id, id), visibleTo(actor)))
        .for("update", { of: schedule })).at(0)
      if (!found) return yield* notFound
      if (!access.isAllowed({ actor, action, resource: SchedulePolicy.resource(found.membershipId) }))
        return yield* new Primitive.Forbidden({ message: "You cannot change this schedule." })
      return found.schedule
    })

    // oxlint-disable-next-line ren/no-comments -- A new chat runs as an agent of the space; a global agent such as ren is the space's default settings.
    const agentIn = Effect.fnUntraced(function* (
      transaction: Pick<Database.Transaction, "select">,
      row: Pick<Row, "organization_id" | "space_id">,
      agentId: Row["agent_id"],
    ) {
      if (!agentId) return Option.some({ isGlobal: true })
      const found = (yield* transaction
        .select({ organizationId: Database.Schema.agent.organization_id })
        .from(Database.Schema.agent)
        .where(
          and(eq(Database.Schema.agent.id, agentId), AgentQueries.isUsableIn(row.space_id, row.organization_id)),
        )).at(0)
      return found ? Option.some({ isGlobal: !found.organizationId }) : Option.none()
    })

    // oxlint-disable-next-line ren/no-comments -- S20: `this-chat` is the root of the calling agent's chat; a chat must be live and in the space.
    const targetOf = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      spaceId: Space.ID,
      target: Schedule.TargetInput,
    ) {
      if (target === "new-chat") return { target_session_id: null }
      const sessionId = target === "this-chat" ? actor.agent?.sessionId : target.sessionId
      if (!sessionId) return yield* invalid("Only an agent in a chat can target this chat.", "target")
      const chat = (yield* transaction
        .select({ rootId: Database.Schema.agent_session.root_id })
        .from(Database.Schema.agent_session)
        .where(
          and(
            eq(Database.Schema.agent_session.id, sessionId),
            eq(Database.Schema.agent_session.space_id, spaceId),
            isNull(Database.Schema.agent_session.archived_at),
          ),
        )).at(0)
      if (!chat) return yield* invalid("The chat is not in this space.", "target")
      return { target_session_id: target === "this-chat" ? chat.rootId : sessionId }
    })

    const whenOfInput = Effect.fnUntraced(function* (when: Schedule.WhenInput, at: Date) {
      const stored = storedOf(when, at)
      const problem = problemOf(stored, at)
      if (problem) return yield* invalid(problem, "when")
      return stored
    })

    // oxlint-disable-next-line ren/no-comments -- S35: at most 50 schedules per space that are not archived and not ended. The space row lock orders concurrent creates.
    const full = Effect.fnUntraced(function* (transaction: Database.Transaction, spaceId: Space.ID) {
      yield* transaction
        .select({ id: Database.Schema.space.id })
        .from(Database.Schema.space)
        .where(eq(Database.Schema.space.id, spaceId))
        .for("update")
      const counted = (yield* transaction
        .select({ total: count() })
        .from(schedule)
        .where(
          and(
            eq(schedule.space_id, spaceId),
            isNull(schedule.archived_at),
            or(isNotNull(schedule.next_run_at), isNotNull(schedule.paused_reason)),
          ),
        )).at(0)
      if ((counted?.total ?? 0) >= Schedule.maximumActive)
        return yield* new Primitive.Conflict({
          message: `This space has ${Schedule.maximumActive} schedules. Archive one before you add another.`,
        })
    })

    const ensure = (runId: ScheduleRun.ID) =>
      DurableRunner.ensure(ScheduleRuns.FireRun, { runId }).pipe(
        Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
        Effect.catchCause((cause) => Effect.logError(`The schedule run ${runId} could not be stored`, cause)),
      )

    // oxlint-disable-next-line ren/no-comments -- S1: the trigger records due fires; every pending run then gets its durable run, also one that a crash left without one.
    const tick = Effect.gen(function* () {
      yield* trigger.claim
      const at = yield* now
      const pending = yield* database.db
        .select({ run, schedule })
        .from(run)
        .innerJoin(schedule, eq(schedule.id, run.schedule_id))
        .where(eq(run.status, "pending"))
      // oxlint-disable-next-line ren/no-comments -- S34: a run still pending 5 minutes past its deadline lost its durable run's result; it fails, so S3 stops counting it.
      const stuck = pending.filter(
        (row) =>
          ScheduleTime.deadlineOf(row.schedule, {
            scheduledAt: row.run.scheduled_at,
            claimedAt: row.run.created_at,
            trigger: row.run.trigger,
          }).getTime() +
            Duration.toMillis(stuckAfter) <
          at.getTime(),
      )
      yield* Effect.forEach(stuck, (row) => fail(row.run.id, "The run did not finish."), { discard: true })
      yield* Effect.forEach(
        pending.filter((row) => !stuck.includes(row)),
        (row) => ensure(row.run.id),
        { discard: true },
      )
    }).pipe(
      Effect.orDie,
      Effect.catchCause((cause) => Effect.logError("A schedule tick failed", cause)),
      Effect.withSpan("Schedules.tick"),
    )

    const finish = (runId: ScheduleRun.ID, outcome: Outcome, at: Date) =>
      database.db
        .update(run)
        .set({
          status: outcome.status,
          reason: outcome.status === "skipped" ? outcome.reason : null,
          error: outcome.status === "failed" ? outcome.error : null,
          started_at: outcome.status === "started" ? at : null,
        })
        .where(and(eq(run.id, runId), eq(run.status, "pending")))

    // oxlint-disable-next-line ren/no-comments -- S36: the last 5 runs that were not skipped all failed.
    const failing = Effect.fnUntraced(function* (scheduleId: Schedule.ID) {
      const recent = yield* database.db
        .select({ status: run.status })
        .from(run)
        .where(and(eq(run.schedule_id, scheduleId), or(eq(run.status, "started"), eq(run.status, "failed"))))
        .orderBy(desc(run.scheduled_at))
        .limit(Schedule.failuresToPause)
      return recent.length === Schedule.failuresToPause && recent.every((row) => row.status === "failed")
    })

    const pause = (scheduleId: Schedule.ID, reason: Schedule.PauseReason) =>
      database.db
        .update(schedule)
        .set({ paused_reason: reason, next_run_at: null, updated_at: sql`now()` })
        .where(and(eq(schedule.id, scheduleId), isNull(schedule.archived_at)))
        .pipe(Effect.andThen(trigger.changed(scheduleId)))

    const afterFailure = Effect.fnUntraced(function* (scheduleId: Schedule.ID) {
      const row = (yield* database.db.select().from(schedule).where(eq(schedule.id, scheduleId))).at(0)
      if (row && !row.paused_reason && !row.archived_at && (yield* failing(scheduleId)))
        yield* pause(scheduleId, "failing")
    })

    const fail = Effect.fnUntraced(function* (runId: ScheduleRun.ID, error: string) {
      const failed = yield* database.db
        .update(run)
        .set({ status: "failed", error })
        .where(and(eq(run.id, runId), eq(run.status, "pending")))
        .returning({ scheduleId: run.schedule_id })
      yield* Effect.forEach(failed, (row) => afterFailure(row.scheduleId), { discard: true })
    })

    // oxlint-disable-next-line ren/no-comments -- S3, S15: a pending earlier run, or the chat of the latest earlier run while it works.
    const previousBusy = Effect.fnUntraced(function* (current: RunRow) {
      const previous = (yield* database.db
        .select()
        .from(run)
        .where(
          and(
            eq(run.schedule_id, current.schedule_id),
            lt(run.scheduled_at, current.scheduled_at),
            or(eq(run.status, "pending"), eq(run.status, "started")),
          ),
        )
        .orderBy(desc(run.scheduled_at))
        .limit(1)).at(0)
      if (!previous) return false
      if (previous.status === "pending") return true
      const chat = yield* runner.get(previous.session_id).pipe(Effect.option)
      return Option.isSome(chat) && chat.value.status === "busy"
    })

    // oxlint-disable-next-line ren/no-comments -- S28, S37: a chat target that is gone archives the schedule; a recurring schedule skips while its chat works.
    const chatBlocked = Effect.fnUntraced(function* (current: RunRow, row: Row, sessionId: Session.ID) {
      const chat = (yield* database.db
        .select({ id: Database.Schema.agent_session.id })
        .from(Database.Schema.agent_session)
        .where(
          and(eq(Database.Schema.agent_session.id, sessionId), isNull(Database.Schema.agent_session.archived_at)),
        )).at(0)
      if (chat) {
        if (!row.cron || current.trigger !== "timed") return Option.none<ScheduleRun.Reason>()
        const target = yield* runner.get(sessionId).pipe(Effect.option)
        // oxlint-disable-next-line ren/no-comments -- S37: a recurring schedule skips a fire while its chat works; a one-time follow-up still queues.
        return Option.exists(target, (found) => found.status === "busy")
          ? Option.some<ScheduleRun.Reason>("previous_run_busy")
          : Option.none<ScheduleRun.Reason>()
      }
      yield* database.db
        .update(schedule)
        .set({ archived_at: sql`now()`, next_run_at: null, updated_at: sql`now()` })
        .where(eq(schedule.id, row.id))
      yield* trigger.changed(row.id)
      return Option.some<ScheduleRun.Reason>("chat_archived")
    })

    // oxlint-disable-next-line ren/no-comments -- S10, S11, S28, S3, S27: why a run must not start now; a schedule whose owner, agent or chat is gone changes as it skips.
    const blocked = Effect.fnUntraced(function* (current: RunRow, row: Row) {
      if (row.archived_at) return Option.some<ScheduleRun.Reason>("archived")
      if (row.paused_reason && current.trigger === "timed") return Option.some<ScheduleRun.Reason>("paused")
      const actsIn = yield* database.transaction((transaction) =>
        SpaceQueries.actsIn(transaction, access, row.organization_id, row.space_id, row.owner_id),
      )
      if (!actsIn) {
        yield* pause(row.id, "owner_left")
        return Option.some<ScheduleRun.Reason>("owner_left")
      }
      if (!row.target_session_id && Option.isNone(yield* agentIn(database.db, row, row.agent_id))) {
        yield* pause(row.id, "agent_removed")
        return Option.some<ScheduleRun.Reason>("agent_removed")
      }
      if (row.target_session_id) return yield* chatBlocked(current, row, row.target_session_id)
      if (current.trigger === "timed" && (yield* previousBusy(current)))
        return Option.some<ScheduleRun.Reason>("previous_run_busy")
      return Option.none<ScheduleRun.Reason>()
    })

    // oxlint-disable-next-line ren/no-comments -- S8, S12, S13, S22: the run's message, as the owner, into a new non-interactive chat or the target chat.
    const deliver = Effect.fnUntraced(function* (current: RunRow, row: Row) {
      const sender = {
        userId: row.owner_id,
        memberId: yield* Actor.memberOf(database.db, { userId: row.owner_id, organizationId: row.organization_id }),
      }
      const origin: ScheduleOrigin.Info = {
        scheduleId: row.id,
        name: row.name,
        scheduledAt: current.scheduled_at.toISOString(),
      }
      const message = { messageId: current.message_id, prompt: { text: row.message }, sender, schedule: origin }
      if (row.target_session_id) {
        yield* runner.send({ ...message, sessionId: row.target_session_id, delivery: "queue" })
        yield* database.db.update(run).set({ session_id: row.target_session_id }).where(eq(run.id, current.id))
        return
      }
      const agent = yield* agentIn(database.db, row, row.agent_id)
      const isGlobal = Option.match(agent, { onNone: () => true, onSome: (found) => found.isGlobal })
      yield* runner
        .create(
          { organizationId: row.organization_id, spaceId: row.space_id, createdBy: row.owner_id },
          {
            sessionId: current.session_id,
            harness: Session.defaultHarness,
            title: titleOf(row, current.scheduled_at),
            interactive: false,
            initialMessage: message,
          },
          isGlobal || !row.agent_id ? {} : { agentId: row.agent_id },
        )
        .pipe(Effect.catchTag("SessionRunner.AlreadyExists", () => Effect.void))
    })

    // oxlint-disable-next-line ren/no-comments -- One try of a run, on the live schedule (S27). A refusal by the brain fails, and the caller tries again.
    const attempt = Effect.fnUntraced(function* (runId: ScheduleRun.ID) {
      const found = (yield* database.db
        .select({ run, schedule })
        .from(run)
        .innerJoin(schedule, eq(schedule.id, run.schedule_id))
        .where(eq(run.id, runId))).at(0)
      if (found?.run.status !== "pending") return Option.none<Outcome>()
      const reason = yield* blocked(found.run, found.schedule)
      if (Option.isSome(reason)) return Option.some<Outcome>({ status: "skipped", reason: reason.value })
      yield* deliver(found.run, found.schedule)
      return Option.some<Outcome>({ status: "started" })
    })

    // oxlint-disable-next-line ren/no-comments -- S15: a refusal is tried again until the next fire time, or for an hour for a one-time or manual run.
    const fire = Effect.fnUntraced(function* (runId: ScheduleRun.ID) {
      const deadline = Effect.gen(function* () {
        const found = (yield* database.db
          .select({ run, schedule })
          .from(run)
          .innerJoin(schedule, eq(schedule.id, run.schedule_id))
          .where(eq(run.id, runId))).at(0)
        if (!found) return new Date(0)
        return ScheduleTime.deadlineOf(found.schedule, {
          scheduledAt: found.run.scheduled_at,
          claimedAt: found.run.created_at,
          trigger: found.run.trigger,
        })
      }).pipe(Effect.orDie)
      const outcome = yield* attempt(runId).pipe(
        Effect.retry({
          schedule: DurableRunner.retry,
          while: (error) =>
            error._tag === "BrainUnavailable" || error._tag === "BrainRejectedError"
              ? Effect.all([deadline, now]).pipe(Effect.map(([end, at]) => at.getTime() < end.getTime()))
              : Effect.succeed(false),
        }),
        Effect.catchTags({
          "SessionRunner.NotFound": (error) =>
            Effect.succeed(Option.some<Outcome>({ status: "failed", error: error.message })),
          BrainUnavailable: () =>
            Effect.succeed(Option.some<Outcome>({ status: "failed", error: "The brain is unavailable." })),
          BrainRejectedError: (error) =>
            Effect.succeed(Option.some<Outcome>({ status: "failed", error: error.message })),
          "Primitive.Forbidden": () =>
            Effect.succeed(Option.some<Outcome>({ status: "skipped", reason: "owner_left" })),
        }),
      )
      if (Option.isNone(outcome)) return
      if (outcome.value.status === "failed") return yield* fail(runId, outcome.value.error)
      yield* finish(runId, outcome.value, yield* now)
    })

    yield* DurableRunner.register(ScheduleRuns.FireRun, (payload) =>
      fire(payload.runId).pipe(
        Effect.orDie,
        Effect.withErrorReporting,
        Effect.catchCause((cause) =>
          now.pipe(
            Effect.flatMap(() => fail(payload.runId, Cause.pretty(cause))),
            Effect.orDie,
            Effect.catchCause((failed) => Effect.logError(`The schedule run ${payload.runId} stopped`, failed)),
          ),
        ),
        Effect.annotateLogs({ run: payload.runId }),
      ),
    )

    // oxlint-disable-next-line ren/no-comments -- S32: the brain refused a start after the run counted it as started.
    yield* runner.onStartRejected((sessionId) =>
      database.db
        .update(run)
        .set({ status: "failed", error: "The brain refused to start the chat." })
        .where(and(eq(run.session_id, sessionId), eq(run.status, "started")))
        .returning({ scheduleId: run.schedule_id })
        .pipe(
          Effect.flatMap((rows) => Effect.forEach(rows, (row) => afterFailure(row.scheduleId), { discard: true })),
          Effect.catchCause((cause) =>
            Effect.logError(`The rejected start of ${sessionId} could not be recorded`, cause),
          ),
        ),
    )

    yield* tick.pipe(
      Effect.andThen(Effect.sleep(tickEvery)),
      Effect.forever,
      Effect.withErrorReporting,
      Effect.forkScoped,
    )

    const list = Effect.fn("Schedules.list")(function* (actor: Actor.Info, input: Schedule.ListInput) {
      const search = input.search?.trim()
      const where = and(
        visibleTo(actor),
        input.spaceId ? eq(schedule.space_id, input.spaceId) : undefined,
        input.status === "paused" ? isNotNull(schedule.paused_reason) : undefined,
        input.status === "active" ? and(isNull(schedule.paused_reason), isNotNull(schedule.next_run_at)) : undefined,
        input.status === "ended" ? and(isNull(schedule.paused_reason), isNull(schedule.next_run_at)) : undefined,
        search ? or(ilike(schedule.name, `%${search}%`), ilike(schedule.message, `%${search}%`)) : undefined,
      )
      return yield* database
        .transaction((transaction) =>
          Effect.gen(function* () {
            const rows = yield* transaction
              .select({ schedule })
              .from(schedule)
              .leftJoin(SchedulePolicy.membership, membershipOf(actor))
              .where(where)
              .orderBy(desc(schedule.created_at), desc(schedule.id))
              .limit(input.pageSize)
              .offset((input.page - 1) * input.pageSize)
            const totals = yield* transaction
              .select({ total: count() })
              .from(schedule)
              .leftJoin(SchedulePolicy.membership, membershipOf(actor))
              .where(where)
            return {
              items: rows.map((row) => toInfo(row.schedule)),
              page: input.page,
              pageSize: input.pageSize,
              total: totals.at(0)?.total ?? 0,
            }
          }),
        )
        .pipe(Effect.orDie)
    })

    const change = <E>(
      name: string,
      action: string,
      write: (
        transaction: Database.Transaction,
        row: Row,
        at: Date,
      ) => Effect.Effect<ReadonlyArray<Row>, E | EffectDrizzleQueryError>,
    ) =>
      Effect.fn(name)(function* (actor: Actor.Info, id: Schedule.ID) {
        const at = yield* now
        const info = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* find(transaction, actor, id, action)
            const rows = yield* write(transaction, row, at)
            return yield* written(rows)
          }),
        )
        yield* trigger.changed(id)
        return info
      })

    return Service.of({
      list,
      get: Effect.fn("Schedules.get")(function* (actor: Actor.Info, idOrSlug: string) {
        if (!isID(idOrSlug)) return yield* notFound
        const found = (yield* database.db
          .select({ schedule })
          .from(schedule)
          .leftJoin(SchedulePolicy.membership, membershipOf(actor))
          .where(and(eq(schedule.id, idOrSlug), visibleTo(actor)))
          .pipe(Effect.orDie)).at(0)
        if (!found) return yield* notFound
        return toInfo(found.schedule)
      }),
      create: Effect.fn("Schedules.create")(function* (actor: Actor.Info, input: Schedule.CreateInput) {
        const at = yield* now
        const info = yield* database.transaction((transaction) =>
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
                resource: SchedulePolicy.resource(space.membershipId),
              })
            )
              return yield* new Primitive.Forbidden({ message: "You cannot add schedules to this space." })
            yield* full(transaction, input.spaceId)
            const placement = { organization_id: actor.organizationId, space_id: input.spaceId }
            if (input.agentId && Option.isNone(yield* agentIn(transaction, placement, input.agentId)))
              return yield* new Primitive.NotFound({ message: "Agent not found." })
            const stored = yield* whenOfInput(input.when, at)
            const target = yield* targetOf(transaction, actor, input.spaceId, input.target ?? "new-chat")
            const taken = yield* transaction
              .select({ slug: schedule.slug })
              .from(schedule)
              .where(and(eq(schedule.space_id, input.spaceId), isNull(schedule.archived_at)))
            const rows = yield* transaction
              .insert(schedule)
              .values({
                id: Schedule.ID.create(),
                ...placement,
                slug: yield* Primitive.slugFor(input, "schedule", new Set(taken.map((row) => row.slug))),
                name: input.name,
                owner_id: actor.userId,
                agent_id: input.agentId ?? null,
                message: input.message,
                ...stored,
                ...target,
                next_run_at: Option.getOrNull(ScheduleTime.nextFire(stored, at)),
              })
              .returning()
            return yield* written(rows)
          }),
        )
        yield* trigger.changed(info.id)
        return info
      }),
      update: Effect.fn("Schedules.update")(function* (
        actor: Actor.Info,
        id: Schedule.ID,
        input: Schedule.UpdateInput,
      ) {
        const at = yield* now
        const info = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = yield* find(transaction, actor, id, actions.update)
            // ast-grep-ignore: no-nullish-comparison, -- null clears the agent; undefined leaves it
            if (input.agentId != null && Option.isNone(yield* agentIn(transaction, row, input.agentId)))
              return yield* new Primitive.NotFound({ message: "Agent not found." })
            const stored = input.when ? yield* whenOfInput(input.when, at) : undefined
            if (stored && !row.paused_reason && !row.next_run_at) yield* full(transaction, row.space_id)
            const target = input.target ? yield* targetOf(transaction, actor, row.space_id, input.target) : undefined
            const isWritten = [input.message, input.agentId, input.when, input.target].some(
              // ast-grep-ignore: no-nullish-comparison, -- a null agent is a change: it clears the agent
              (value) => value !== undefined,
            )
            const rows = yield* transaction
              .update(schedule)
              .set({
                name: input.name,
                message: input.message,
                agent_id: input.agentId,
                ...stored,
                ...target,
                ...(stored &&
                  !row.paused_reason && { next_run_at: Option.getOrNull(ScheduleTime.nextFire(stored, at)) }),
                ...(isWritten && { owner_id: actor.userId }),
                updated_at: sql`now()`,
              })
              .where(eq(schedule.id, id))
              .returning()
            return yield* written(rows)
          }),
        )
        yield* trigger.changed(id)
        return info
      }),
      archive: change("Schedules.archive", actions.archive, (transaction, row) =>
        transaction
          .update(schedule)
          .set({ archived_at: sql`now()`, next_run_at: null, updated_at: sql`now()` })
          .where(eq(schedule.id, row.id))
          .returning(),
      ),
      pause: change("Schedules.pause", actions.pause, (transaction, row) =>
        row.paused_reason
          ? Effect.succeed([row])
          : transaction
              .update(schedule)
              .set({ paused_reason: "user", next_run_at: null, updated_at: sql`now()` })
              .where(eq(schedule.id, row.id))
              .returning(),
      ),
      resume: (actor, id) =>
        change("Schedules.resume", actions.resume, (transaction, row, at) =>
          Effect.gen(function* () {
            if (!row.paused_reason) return [row]
            if (row.paused_reason === "agent_removed" && Option.isNone(yield* agentIn(transaction, row, row.agent_id)))
              return yield* new Primitive.Conflict({ message: "Pick another agent for this schedule first." })
            return yield* transaction
              .update(schedule)
              .set({
                paused_reason: null,
                next_run_at: Option.getOrNull(ScheduleTime.nextFire(row, at)),
                ...(row.paused_reason === "owner_left" && { owner_id: actor.userId }),
                updated_at: sql`now()`,
              })
              .where(eq(schedule.id, row.id))
              .returning()
          }),
        )(actor, id),
      run: (actor, id) =>
        Effect.gen(function* () {
          const info = yield* change("Schedules.run", actions.run, (transaction, row, at) =>
            ScheduleRuns.insert(transaction, row.id, at, "manual").pipe(Effect.as([row])),
          )(actor, id)
          const pending = yield* database.db
            .select({ id: run.id })
            .from(run)
            .where(and(eq(run.schedule_id, id), eq(run.status, "pending")))
            .pipe(Effect.orDie)
          yield* Effect.forEach(pending, (row) => ensure(row.id), { discard: true })
          return info
        }),
      runs: Effect.fn("Schedules.runs")(function* (actor: Actor.Info, input: ScheduleRun.ListInput) {
        return yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              const visible = (yield* transaction
                .select({ id: schedule.id, membershipId: SchedulePolicy.membership.id })
                .from(schedule)
                .leftJoin(SchedulePolicy.membership, membershipOf(actor))
                .where(and(eq(schedule.id, input.scheduleId), eq(schedule.organization_id, actor.organizationId)))).at(
                0,
              )
              const allowed =
                visible &&
                access.isAllowed({
                  actor,
                  action: actions.runs,
                  resource: SchedulePolicy.resource(visible.membershipId),
                })
              if (!allowed) return { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
              const rows = yield* transaction
                .select()
                .from(run)
                .where(eq(run.schedule_id, input.scheduleId))
                .orderBy(desc(run.scheduled_at), desc(run.id))
                .limit(input.pageSize)
                .offset((input.page - 1) * input.pageSize)
              const totals = yield* transaction
                .select({ total: count() })
                .from(run)
                .where(eq(run.schedule_id, input.scheduleId))
              return {
                items: rows.map(toRun),
                page: input.page,
                pageSize: input.pageSize,
                total: totals.at(0)?.total ?? 0,
              }
            }),
          )
          .pipe(Effect.orDie)
      }),
      tick,
    })
  }),
)
