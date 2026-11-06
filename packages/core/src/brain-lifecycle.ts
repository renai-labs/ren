export * as BrainLifecycle from "./brain-lifecycle.js"

import { Observability } from "@ren/schema/observability"
import { Database } from "@ren/db/database"
import type { State as BrainState } from "@ren/host-api/brain-api"
import type { PullSession } from "@ren/host-api/ren-host-api"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Signature } from "@ren/schema/signature"
import { and, eq, gt, inArray, isNotNull, isNull, notExists, notInArray, or, sql } from "drizzle-orm"
import { Clock, Config, Context, DateTime, Duration, Effect, Layer, Option, Schedule, Schema, Stream } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { BrainClient } from "./brain-client.js"
import { DurableRunner } from "./durable-runner.js"
import { Deployment } from "./deployment.js"
import { Environments } from "./environments.js"
import type { MachineAccess } from "./machine-access.js"
import { MachineLifecycle } from "./machine-lifecycle.js"
import { MachineProvider } from "./machine-provider.js"
import { SandboxEgress } from "./sandbox-egress.js"

export type Access = MachineAccess.Access<BrainClient.Target>

export interface Interface extends MachineAccess.Interface<Brain.ID, BrainClient.Target> {
  readonly ready: (brainId: Brain.ID) => Effect.Effect<BrainClient.Target, MachineLifecycle.Unavailable>
  readonly awake: (brainId: Brain.ID) => Effect.Effect<Option.Option<BrainClient.Target>>
  readonly observe: (brainId: Brain.ID, sessions: ReadonlyArray<PullSession>) => Effect.Effect<void>
  readonly hand: (brainId: Brain.ID) => Effect.Effect<Option.Option<Hand>>
  readonly cleanup: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/BrainLifecycle") {}

// oxlint-disable-next-line ren/no-comments -- The brain's own machine as an environment. It is behind the egress when its brain is (R19).
export interface Hand extends MachineProvider.Hand {
  readonly egress: boolean
  readonly canMount: boolean
}

const CleanupRun = DurableRunner.make("BrainCleanup", {
  payload: { day: Schema.String },
  idempotencyKey: (payload) => `cleanup:${payload.day}`,
})

const BrainRun = DurableRunner.make("BrainRun", {
  payload: { brainId: Brain.ID, epoch: Schema.Int },
  idempotencyKey: (payload) => `brain:${payload.brainId}:${payload.epoch}`,
})

const brains = Database.Schema.brain

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const provider = yield* MachineProvider.Brain
    const client = yield* BrainClient.Service
    const engine = yield* WorkflowEngine.WorkflowEngine
    const environments = yield* Environments.Service
    const egress = yield* SandboxEgress.Service
    const wakeWithin = yield* Config.Duration("BRAIN_WAKE_TIMEOUT").pipe(
      Config.withDefault(MachineLifecycle.timing.wake),
    )
    const bootWithin = yield* Config.Duration("BRAIN_BOOT_TIMEOUT").pipe(
      Config.withDefault(MachineLifecycle.timing.boot),
    )
    const sandboxVariables = yield* Deployment.sandboxVariables

    const read = (brainId: Brain.ID) =>
      database.db
        .select()
        .from(brains)
        .where(eq(brains.id, brainId))
        .pipe(
          Effect.orDie,
          Effect.flatMap((rows) =>
            Option.match(Option.fromNullishOr(rows.at(0)), {
              onNone: () => Effect.die(new Error(`Brain ${brainId} does not exist`)),
              onSome: Effect.succeed,
            }),
          ),
        )

    const update = (brainId: Brain.ID, values: Partial<typeof brains.$inferInsert>) =>
      database.db.update(brains).set(values).where(eq(brains.id, brainId)).pipe(Effect.orDie, Effect.asVoid)

    type Row = typeof brains.$inferSelect

    const targetOf = (row: Row): Option.Option<BrainClient.Target> =>
      row.url
        ? Option.some({
            brainId: row.id,
            generation: row.generation,
            organizationId: row.organization_id,
            url: row.url,
            keyIds: row.key_ids,
            egress: row.egress,
          })
        : Option.none()

    const now = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis))

    const interruptBusy = (transaction: Database.Transaction, brainId: Brain.ID, at: Date) =>
      transaction
        .update(Database.Schema.opencode_session)
        .set({ time_suspended: null, idle_outcome: "interrupted", time_idle: at.getTime() })
        .where(
          and(
            inArray(
              Database.Schema.opencode_session.session_id,
              transaction
                .select({ id: Database.Schema.agent_session.id })
                .from(Database.Schema.agent_session)
                .where(eq(Database.Schema.agent_session.brain_id, brainId)),
            ),
            isNotNull(Database.Schema.opencode_session.time_suspended),
          ),
        )

    const lose = Effect.fn("BrainLifecycle.lose")(function* (brainId: Brain.ID, generation: number, at: Date) {
      yield* database
        .transaction((transaction) =>
          Effect.gen(function* () {
            const marked = yield* transaction
              .update(brains)
              .set({ phase: "replacing" })
              .where(
                and(
                  eq(brains.id, brainId),
                  eq(brains.generation, generation),
                  notInArray(brains.phase, ["creating", "replacing"]),
                ),
              )
              .returning({ id: brains.id })
            if (marked.length === 0) return
            yield* Effect.logWarning(`The sandbox of brain ${brainId} is gone; its busy chats are interrupted`)
            yield* interruptBusy(transaction, brainId, at)
          }),
        )
        .pipe(Effect.orDie)
    })

    // oxlint-disable-next-line ren/no-comments -- A brain goes behind the egress when this Ren runs one and its provider can route a sandbox through it. The answer is kept on the row (egress); every later step reads the row, never the setting.
    const isBehindEgress = egress.enabled && provider.canEgress

    const machines = MachineLifecycle.make({
      name: "BrainLifecycle",
      noun: "Brain",
      annotation: "brain",
      provider,
      isBehindEgress,
      bootWithin,
      wakeWithin,
      read,
      update,
      replace: (row, at) =>
        database
          .transaction((transaction) =>
            Effect.gen(function* () {
              yield* transaction
                .update(brains)
                .set({
                  generation: sql`${brains.generation} + 1`,
                  binding: null,
                  url: null,
                  keep_alive_until: null,
                  phase: "creating",
                })
                .where(eq(brains.id, row.id))
              yield* interruptBusy(transaction, row.id, at)
            }),
          )
          .pipe(Effect.orDie),
      lose,
      ensure: (row) =>
        DurableRunner.ensure(BrainRun, { brainId: row.id, epoch: row.run_epoch }).pipe(
          Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
        ),
      proxyFor: (row) =>
        egress.proxyFor({ brainId: row.id, generation: row.generation, organizationId: row.organization_id }),
      retire: egress.retire,
      variables: Effect.fnUntraced(function* (row) {
        return {
          REN_URL: client.renUrl,
          REN_BRAIN_ID: row.id,
          REN_BRAIN_GENERATION: String(row.generation),
          BRAIN_PUBLIC_KEYS: Schema.encodeSync(Signature.PublicKeys)(client.publicKeys),
          ...sandboxVariables({
            "ren.organization.id": row.organization_id,
            "ren.space.id": row.space_id,
            "ren.brain.id": row.id,
            "ren.brain.generation": String(row.generation),
          }),
          ...(yield* environments.executorVariables(Environment.ofBrain(row.id))),
        }
      }),
      created: (brainId) => update(brainId, { key_ids: client.publicKeys.map((key) => key.id) }),
      target: targetOf,
      boot: Effect.fnUntraced(function* (target, within) {
        const api = yield* client.brain(target)
        const answered = { last: Option.none<BrainState>() }
        // oxlint-disable-next-line ren/no-comments -- Ready means the brain answers and has reached Ren with a pull, so a brain whose path to Ren is broken (egress, CA, DNS) fails with that reason instead of looking ready (M1; ren-v1 INV-15). An older brain does not report pulledAt.
        const state = yield* api.brain["brain.state"]().pipe(
          Effect.tap((found) =>
            Effect.sync(() => {
              answered.last = Option.some(found)
            }),
          ),
          Effect.flatMap((found) =>
            // ast-grep-ignore: no-nullish-comparison, -- null is "not yet pulled"; an older brain leaves pulledAt out and is not waited for
            found.pulledAt === null
              ? Effect.fail(new MachineLifecycle.Unavailable({ message: "not reached Ren" }))
              : Effect.succeed(found),
          ),
          Effect.retry({ schedule: Schedule.spaced(MachineLifecycle.timing.poll) }),
          Effect.timeoutOption(within),
        )
        if (Option.isSome(state)) return Option.none()
        return Option.some(
          Option.isSome(answered.last)
            ? `The brain answers but did not reach Ren within ${Duration.format(within)}`
            : `The brain did not answer within ${Duration.format(within)}`,
        )
      }),
      wake: Effect.fnUntraced(function* (target, within) {
        const api = yield* client.brain(target)
        const woke = yield* api.brain["brain.wake"]().pipe(
          Effect.retry({ schedule: Schedule.spaced(MachineLifecycle.timing.poll) }),
          Effect.timeoutOption(within),
        )
        if (Option.isSome(woke)) return true
        // oxlint-disable-next-line ren/no-comments -- A slow wake is not a dead brain: Ren replaces it only when /ren/state does not answer either (E132).
        const answers = yield* api.brain["brain.state"]().pipe(Effect.timeoutOption("10 seconds"), Effect.option)
        if (Option.isNone(answers) || Option.isNone(answers.value)) {
          yield* Effect.logWarning(
            `Brain ${target.brainId} did not confirm its wake in time and does not answer; Ren replaces it`,
          )
          return false
        }
        yield* Effect.logWarning(
          `Brain ${target.brainId} answers but did not confirm its wake within ${Duration.format(within)}`,
        )
        return true
      }),
      answers: (target) =>
        client.brain(target).pipe(
          Effect.flatMap((api) => api.brain["brain.state"]()),
          Effect.timeoutOption(MachineLifecycle.timing.probeTimeout),
          Effect.option,
          Effect.map((answered) => Option.isSome(answered) && Option.isSome(answered.value)),
        ),
    })

    yield* provider.lost.pipe(
      Stream.runForEach((lost) =>
        Schema.is(Brain.ID)(lost.id) ? machines.lose(lost.id, lost.generation) : Effect.void,
      ),
      Effect.withErrorReporting,
      Effect.forkScoped,
    )

    // oxlint-disable-next-line ren/no-comments -- At boot, Ren reaches each running brain once, so its server token carries Ren's current address (E119). Asleep brains learn it at their wake.
    yield* Effect.gen(function* () {
      const running = yield* database.db
        .select()
        .from(brains)
        .where(and(eq(brains.phase, "ready"), gt(brains.keep_alive_until, yield* now)))
        .pipe(Effect.orDie)
      yield* Effect.forEach(
        running,
        (row) =>
          Option.match(targetOf(row), {
            onNone: () => Effect.void,
            onSome: (target) =>
              client.brain(target).pipe(
                Effect.flatMap((api) => api.brain["brain.state"]()),
                Effect.timeout(MachineLifecycle.timing.wake),
                Effect.catchCause((cause) =>
                  Effect.logWarning(`Brain ${row.id} did not answer Ren's boot call`, cause),
                ),
              ),
          }),
        { concurrency: 8, discard: true },
      )
    }).pipe(Effect.withErrorReporting, Effect.forkScoped)

    const cleanup = Effect.gen(function* () {
      const chats = Database.Schema.agent_session
      const resting = yield* database.db
        .select({ id: brains.id, generation: brains.generation, binding: brains.binding })
        .from(brains)
        .innerJoin(Database.Schema.space, eq(Database.Schema.space.id, brains.space_id))
        .where(
          and(
            isNotNull(brains.binding),
            or(
              isNotNull(Database.Schema.space.archived_at),
              notExists(
                database.db
                  .select({ id: chats.id })
                  .from(chats)
                  .where(and(eq(chats.brain_id, brains.id), isNull(chats.archived_at))),
              ),
            ),
          ),
        )
        .pipe(Effect.orDie)
      yield* Effect.forEach(
        resting,
        (row) =>
          machines
            .rest(row)
            .pipe(Effect.catch((error) => Effect.logWarning(`Cleanup of brain ${row.id} failed`, error))),
        { discard: true },
      )
      const listed = (yield* provider.list.pipe(
        Effect.catch((error) =>
          Effect.logWarning("Cleanup could not list sandboxes", error).pipe(
            Effect.as<ReadonlyArray<MachineProvider.Listed>>([]),
          ),
        ),
      )).flatMap((each) =>
        Schema.is(Brain.ID)(each.id) ? [{ binding: each.binding, brainId: each.id, generation: each.generation }] : [],
      )
      const known = new Map(
        (yield* database.db
          .select({ id: brains.id, generation: brains.generation })
          .from(brains)
          .where(
            inArray(
              brains.id,
              listed.map((each) => each.brainId),
            ),
          )
          .pipe(Effect.orDie)).map((each) => [each.id, each.generation]),
      )
      yield* Effect.forEach(
        listed.filter((each) => known.get(each.brainId) !== each.generation),
        (each) =>
          provider
            .destroy(each.binding)
            .pipe(Effect.catch((error) => Effect.logWarning(`Cleanup of a sandbox of ${each.brainId} failed`, error))),
        { discard: true },
      )
      const busy = yield* database.db
        .selectDistinct({ brainId: chats.brain_id })
        .from(chats)
        .innerJoin(Database.Schema.opencode_session, eq(Database.Schema.opencode_session.session_id, chats.id))
        .where(isNotNull(Database.Schema.opencode_session.time_suspended))
        .pipe(Effect.orDie)
      yield* Effect.forEach(busy, (each) => machines.check(each.brainId), { discard: true })
    }).pipe(Effect.withSpan("BrainLifecycle.cleanup"))

    yield* DurableRunner.register(CleanupRun, (payload) => DurableRunner.supervise(`cleanup:${payload.day}`, cleanup))

    yield* Effect.gen(function* () {
      const day = DateTime.formatIsoDateUtc(yield* DateTime.now)
      yield* DurableRunner.ensure(CleanupRun, { day })
    }).pipe(
      Effect.repeat(Schedule.spaced("1 hour")),
      Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
      Effect.withErrorReporting,
      Effect.forkScoped,
    )

    yield* DurableRunner.register(BrainRun, (payload) =>
      DurableRunner.supervise(
        `brain:${payload.brainId}`,
        machines
          .run(payload.brainId)
          .pipe(Observability.Trace.brainRun, Effect.annotateSpans("ren.brain.id", payload.brainId)),
      ).pipe(
        Effect.andThen(
          database.db
            .update(brains)
            .set({ run_epoch: payload.epoch + 1 })
            .where(and(eq(brains.id, payload.brainId), eq(brains.run_epoch, payload.epoch)))
            .pipe(Effect.orDie),
        ),
      ),
    )

    return Service.of({
      ensure: machines.ensure,
      access: machines.access,
      check: machines.check,
      retry: machines.retry,
      awake: machines.awake,
      ready: machines.ready,
      observe: Effect.fn("BrainLifecycle.observe")(function* (brainId: Brain.ID, sessions: ReadonlyArray<PullSession>) {
        const row = yield* read(brainId)
        const at = yield* now
        const previous = row.progress ?? {}
        const busy = sessions.filter((session) => session.busy)
        const progressed = busy.some((session) => previous[session.id] !== session.progress)
        const lastProgress = progressed ? at : row.last_progress_at
        yield* update(brainId, {
          progress: Object.fromEntries(sessions.map((session) => [session.id, session.progress])),
          ...(progressed && { last_progress_at: at }),
        })
        const moving =
          busy.length > 0 &&
          Option.exists(
            Option.fromNullishOr(lastProgress),
            (last) => at.getTime() - last.getTime() < Duration.toMillis(MachineLifecycle.timing.stuck),
          )
        if (moving)
          yield* machines
            .keepAlive(row, MachineLifecycle.timing.busy)
            .pipe(Effect.catch((error) => Effect.logWarning("keepAlive failed", error)))
      }),
      cleanup,
      hand: Effect.fn("BrainLifecycle.hand")(function* (brainId: Brain.ID) {
        const row = yield* read(brainId)
        if (!row.binding) return Option.none()
        return Option.some({
          ...(yield* provider.hand(row.binding).pipe(Effect.orDie)),
          egress: row.egress,
          canMount: provider.canMount,
        })
      }),
    })
  }),
)
