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
import { SandboxEgress } from "./sandbox-egress.js"
import { SandboxProvider } from "./sandbox-provider.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("BrainLifecycle.Unavailable", {
  message: Schema.String,
}) {}

export type Access =
  | { readonly _tag: "Ready"; readonly target: BrainClient.Target }
  | { readonly _tag: "Starting"; readonly phase: string }
  | { readonly _tag: "Failed"; readonly reason: string }

export interface Interface {
  readonly ensure: (brainId: Brain.ID) => Effect.Effect<void>
  readonly access: (brainId: Brain.ID) => Effect.Effect<Access>
  readonly ready: (brainId: Brain.ID) => Effect.Effect<BrainClient.Target, Unavailable>
  readonly awake: (brainId: Brain.ID) => Effect.Effect<Option.Option<BrainClient.Target>>
  readonly retry: (brainId: Brain.ID) => Effect.Effect<void>
  readonly observe: (brainId: Brain.ID, sessions: ReadonlyArray<PullSession>) => Effect.Effect<void>
  readonly hand: (brainId: Brain.ID) => Effect.Effect<Option.Option<Hand>>
  readonly check: (brainId: Brain.ID) => Effect.Effect<void>
  readonly cleanup: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/BrainLifecycle") {}

// oxlint-disable-next-line ren/no-comments -- The brain's own machine as an environment. It is behind the egress when its brain is (R19).
export interface Hand extends SandboxProvider.Hand {
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

export const timing = {
  boot: Duration.seconds(120),
  wake: Duration.seconds(60),
  idle: Duration.minutes(10),
  busy: Duration.minutes(30),
  stuck: Duration.minutes(30),
  accessMargin: Duration.minutes(2),
  poll: Duration.seconds(1),
  failures: 3,
}

type Row = typeof Database.Schema.brain.$inferSelect

const brains = Database.Schema.brain

const startKinds: Readonly<Partial<Record<Brain.Phase, string>>> = {
  creating: "new",
  booting: "new",
  replacing: "replace",
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const provider = yield* SandboxProvider.Service
    const client = yield* BrainClient.Service
    const engine = yield* WorkflowEngine.WorkflowEngine
    const environments = yield* Environments.Service
    const egress = yield* SandboxEgress.Service
    const wakeWithin = yield* Config.Duration("BRAIN_WAKE_TIMEOUT").pipe(Config.withDefault(timing.wake))
    const bootWithin = yield* Config.Duration("BRAIN_BOOT_TIMEOUT").pipe(Config.withDefault(timing.boot))
    const telemetry = yield* Deployment.telemetry
    const signals = [
      ...(Option.isSome(telemetry.traces) ? ["traces"] : []),
      ...(Option.isSome(telemetry.logs) ? ["logs"] : []),
      ...(Option.isSome(telemetry.metrics) ? ["metrics"] : []),
    ].join(",")

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

    const keepAlive = Effect.fnUntraced(function* (row: Row, window: Duration.Duration) {
      if (!row.binding) return
      const at = yield* now
      const left = row.keep_alive_until ? row.keep_alive_until.getTime() - at.getTime() : 0
      if (left > Duration.toMillis(window) / 2) return
      yield* provider.keepAlive(row.binding, window)
      yield* update(row.id, { keep_alive_until: new Date(at.getTime() + Duration.toMillis(window)) })
    })

    const fail = Effect.fnUntraced(function* (row: Row, reason: string, next: Brain.Phase) {
      const failures = row.failures + 1
      yield* Effect.logWarning(`Brain ${row.id} failed (${failures}/${timing.failures}): ${reason}`)
      yield* update(row.id, {
        failures,
        failure: reason,
        phase: failures >= timing.failures ? "failed" : next,
      })
    })

    const waitFor = <A, E>(effect: Effect.Effect<A, E>, within: Duration.Duration) =>
      effect.pipe(Effect.retry({ schedule: Schedule.spaced(timing.poll) }), Effect.timeoutOption(within))

    const env = Effect.fnUntraced(function* (row: Row) {
      return {
        REN_URL: client.renUrl,
        REN_BRAIN_ID: row.id,
        REN_BRAIN_GENERATION: String(row.generation),
        BRAIN_PUBLIC_KEYS: Schema.encodeSync(Signature.PublicKeys)(client.publicKeys),
        ...(signals && { REN_TELEMETRY: signals }),
        ...(yield* environments.executorVariables(Environment.ofBrain(row.id))),
      }
    })

    // oxlint-disable-next-line ren/no-comments -- Capacity is not a failure (E88): the brain shows "waiting for capacity", and the step that hit it runs again after Retry-After.
    const waitForCapacity = Effect.fnUntraced(function* (row: Row, error: SandboxProvider.Capacity) {
      yield* Effect.logWarning(`Waiting for capacity: ${error.message}`)
      yield* update(row.id, { phase: "capacity" })
      yield* Effect.sleep(error.retryAfter)
      yield* update(row.id, { phase: row.phase })
    })

    // oxlint-disable-next-line ren/no-comments -- A brain goes behind the egress when this Ren runs one and its provider can route a sandbox through it. The answer is kept on the row (egress); every later step reads the row, never the setting.
    const behindEgress = egress.enabled && provider.canEgress

    const create = Effect.fnUntraced(function* (row: Row) {
      const proxy = behindEgress
        ? yield* egress.proxyFor({ brainId: row.id, generation: row.generation, organizationId: row.organization_id })
        : Option.none<SandboxProvider.Proxy>()
      const created = yield* provider
        .create({
          brainId: row.id,
          generation: row.generation,
          organizationId: row.organization_id,
          spaceId: row.space_id,
          // oxlint-disable-next-line ren/no-comments -- Behind an egress, the brain calls Ren at REN_URL with the placeholder ren:REN; the egress puts in the host token (C8, C49).
          env: { ...(yield* env(row)), ...(Option.isSome(proxy) && { REN_EGRESS: "1" }) },
          proxy,
        })
        .pipe(
          Effect.map(Option.some),
          Effect.catchTag("SandboxProvider.Capacity", (error) =>
            waitForCapacity(row, error).pipe(Effect.as(Option.none<SandboxProvider.Created>())),
          ),
        )
      if (Option.isNone(created)) return false
      yield* update(row.id, {
        provider: provider.kind,
        binding: created.value.binding,
        template: provider.template,
        egress: Option.isSome(proxy),
        url: created.value.url,
        key_ids: client.publicKeys.map((key) => key.id),
        phase: "booting",
        keep_alive_until: new Date((yield* now).getTime() + Duration.toMillis(Duration.minutes(10))),
      })
      return false
    })

    const boot = Effect.fnUntraced(function* (row: Row) {
      const target = Option.getOrUndefined(targetOf(row))
      if (!target) return yield* update(row.id, { phase: "creating" }).pipe(Effect.as(false))
      const api = yield* client.brain(target)
      const answered = { last: Option.none<BrainState>() }
      // oxlint-disable-next-line ren/no-comments -- Ready means the brain answers and has reached Ren with a pull, so a brain whose path to Ren is broken (egress, CA, DNS) fails with that reason instead of looking ready (M1; ren-v1 INV-15). An older brain does not report pulledAt.
      const state = yield* waitFor(
        api.brain["brain.state"]().pipe(
          Effect.tap((found) =>
            Effect.sync(() => {
              answered.last = Option.some(found)
            }),
          ),
          Effect.flatMap((found) =>
            // ast-grep-ignore: no-nullish-comparison, -- null is "not yet pulled"; an older brain leaves pulledAt out and is not waited for
            found.pulledAt === null
              ? Effect.fail(new Unavailable({ message: "not reached Ren" }))
              : Effect.succeed(found),
          ),
        ),
        bootWithin,
      )
      if (Option.isNone(state)) {
        if (row.binding) yield* provider.destroy(row.binding).pipe(Effect.ignore)
        yield* fail(
          row,
          Option.isSome(answered.last)
            ? `The brain answers but did not reach Ren within ${Duration.format(bootWithin)}`
            : `The brain did not answer within ${Duration.format(bootWithin)}`,
          "creating",
        )
        yield* update(row.id, { binding: null, url: null })
        return false
      }
      yield* update(row.id, { phase: "ready", failures: 0, failure: null })
      yield* keepAlive(yield* read(row.id), timing.idle)
      return true
    })

    const resume = Effect.fnUntraced(function* (row: Row) {
      if (!row.binding) return yield* update(row.id, { phase: "creating" }).pipe(Effect.as(false))
      // oxlint-disable-next-line ren/no-comments -- An asleep brain on an older build moves to the current one by a replace (E120). Only this step checks, so a running brain is never replaced for its build.
      if (row.template && provider.template && row.template !== provider.template) {
        yield* Effect.logInfo(`Brain ${row.id} runs build ${row.template}; Ren replaces it with ${provider.template}`)
        return yield* update(row.id, { phase: "replacing" }).pipe(Effect.as(false))
      }
      // oxlint-disable-next-line ren/no-comments -- A brain built for the other egress mode would get the wrong keys; it moves to the current one by a replace, as for a build (E120).
      if (row.egress !== behindEgress) {
        yield* Effect.logInfo(
          `Brain ${row.id} was created ${row.egress ? "behind" : "without"} the egress; Ren replaces it`,
        )
        return yield* update(row.id, { phase: "replacing" }).pipe(Effect.as(false))
      }
      const proxy = behindEgress
        ? yield* egress.proxyFor({ brainId: row.id, generation: row.generation, organizationId: row.organization_id })
        : Option.none<SandboxProvider.Proxy>()
      const connected = yield* provider.connect(row.binding, proxy).pipe(
        Effect.map((found) => ({ _tag: "Connected", url: found.url }) as const),
        Effect.catchTag("SandboxProvider.Gone", () => Effect.succeed({ _tag: "Gone" } as const)),
        Effect.catchTag("SandboxProvider.Capacity", (error) =>
          waitForCapacity(row, error).pipe(Effect.as({ _tag: "Waited" } as const)),
        ),
      )
      if (connected._tag === "Waited") return false
      if (connected._tag === "Gone") return yield* update(row.id, { phase: "replacing" }).pipe(Effect.as(false))
      yield* update(row.id, { url: connected.url, keep_alive_until: null })
      yield* keepAlive({ ...row, keep_alive_until: null }, timing.idle)
      yield* update(row.id, { phase: "waking" })
      return false
    })

    const wake = Effect.fnUntraced(function* (row: Row) {
      const target = Option.getOrUndefined(targetOf(row))
      if (!target) return yield* update(row.id, { phase: "replacing" }).pipe(Effect.as(false))
      const api = yield* client.brain(target)
      const woke = yield* api.brain["brain.wake"]().pipe(
        Effect.retry({ schedule: Schedule.spaced(timing.poll) }),
        Effect.timeoutOption(wakeWithin),
      )
      // oxlint-disable-next-line ren/no-comments -- A slow wake is not a dead brain: Ren replaces it only when /ren/state does not answer either (E132).
      if (Option.isNone(woke)) {
        const answers = yield* api.brain["brain.state"]().pipe(Effect.timeoutOption("10 seconds"), Effect.option)
        if (Option.isNone(answers) || Option.isNone(answers.value)) {
          yield* Effect.logWarning(
            `Brain ${row.id} did not confirm its wake in time and does not answer; Ren replaces it`,
          )
          return yield* update(row.id, { phase: "replacing" }).pipe(Effect.as(false))
        }
        yield* Effect.logWarning(
          `Brain ${row.id} answers but did not confirm its wake within ${Duration.format(wakeWithin)}`,
        )
      }
      yield* update(row.id, { phase: "ready", failures: 0, failure: null })
      return true
    })

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

    const replace = Effect.fnUntraced(function* (row: Row) {
      yield* database
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
            yield* interruptBusy(transaction, row.id, yield* now)
          }),
        )
        .pipe(Effect.orDie)
      yield* egress.retire(row.id)
      if (row.binding)
        yield* provider
          .destroy(row.binding)
          .pipe(Effect.catch((error) => Effect.logWarning("Destroying the replaced sandbox failed", error)))
      return false
    })

    const lose = Effect.fn("BrainLifecycle.lose")(function* (lost: SandboxProvider.Lost) {
      yield* database
        .transaction((transaction) =>
          Effect.gen(function* () {
            const marked = yield* transaction
              .update(brains)
              .set({ phase: "replacing" })
              .where(
                and(
                  eq(brains.id, lost.brainId),
                  eq(brains.generation, lost.generation),
                  notInArray(brains.phase, ["creating", "replacing"]),
                ),
              )
              .returning({ id: brains.id })
            if (marked.length === 0) return
            yield* Effect.logWarning(`The sandbox of brain ${lost.brainId} is gone; its busy chats are interrupted`)
            yield* interruptBusy(transaction, lost.brainId, yield* now)
          }),
        )
        .pipe(Effect.orDie)
    })

    yield* provider.lost.pipe(Stream.runForEach(lose), Effect.withErrorReporting, Effect.forkScoped)

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
                Effect.timeout(timing.wake),
                Effect.catchCause((cause) =>
                  Effect.logWarning(`Brain ${row.id} did not answer Ren's boot call`, cause),
                ),
              ),
          }),
        { concurrency: 8, discard: true },
      )
    }).pipe(Effect.withErrorReporting, Effect.forkScoped)

    const check = Effect.fn("BrainLifecycle.check")(function* (brainId: Brain.ID) {
      const row = yield* read(brainId)
      if (!row.binding) return
      const status = yield* provider
        .status(row.binding)
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("The sandbox status is unknown", error).pipe(Effect.as("running" as const)),
          ),
        )
      if (status === "gone") yield* lose({ brainId, generation: row.generation })
      // oxlint-disable-next-line ren/no-comments -- A paused sandbox wakes; it is never replaced here (E123).
      if (status === "paused" && row.phase === "ready") yield* update(row.id, { phase: "resuming" })
    })

    const rest = Effect.fnUntraced(function* (row: Pick<Row, "id" | "generation" | "binding">) {
      if (!row.binding) return
      yield* egress.retire(row.id)
      yield* provider.destroy(row.binding)
      yield* update(row.id, {
        generation: row.generation + 1,
        binding: null,
        url: null,
        keep_alive_until: null,
        phase: "creating",
      })
    })

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
        (row) => rest(row).pipe(Effect.catch((error) => Effect.logWarning(`Cleanup of brain ${row.id} failed`, error))),
        { discard: true },
      )
      const listed = yield* provider.list.pipe(
        Effect.catch((error) =>
          Effect.logWarning("Cleanup could not list sandboxes", error).pipe(
            Effect.as<ReadonlyArray<SandboxProvider.Listed>>([]),
          ),
        ),
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
      yield* Effect.forEach(busy, (each) => check(each.brainId), { discard: true })
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

    const settle = Effect.fnUntraced(function* (row: Row) {
      const at = yield* now
      if (row.keep_alive_until && row.keep_alive_until.getTime() > at.getTime()) return true
      return yield* update(row.id, { phase: row.binding ? "resuming" : "creating" }).pipe(Effect.as(false))
    })

    const phases = {
      creating: create,
      booting: boot,
      resuming: resume,
      waking: wake,
      replacing: replace,
      ready: settle,
      failed: () => Effect.succeed(true),
      capacity: (row) => update(row.id, { phase: row.binding ? "resuming" : "creating" }).pipe(Effect.as(false)),
    } satisfies Record<Brain.Phase, (row: Row) => Effect.Effect<boolean, unknown>>

    const step = Effect.fn("BrainLifecycle.step")(function* (brainId: Brain.ID) {
      const row = yield* read(brainId)
      return yield* phases[row.phase](row)
    })

    const run = (brainId: Brain.ID) =>
      Effect.gen(function* () {
        const first = yield* read(brainId)
        let worked = false
        while (!(yield* step(brainId))) {
          worked = true
          yield* Effect.yieldNow
        }
        if (worked)
          yield* Effect.annotateCurrentSpan(
            "ren.brain.start_kind",
            startKinds[first.phase] ?? (first.binding ? "resume" : "new"),
          )
      }).pipe(
        Effect.catchTag("SandboxProvider.Failed", (error) =>
          read(brainId).pipe(
            Effect.flatMap((row) =>
              row.phase === "creating" || row.phase === "booting" || row.phase === "waking"
                ? fail(row, error.message, row.phase)
                : Effect.void,
            ),
            Effect.andThen(Effect.fail(error)),
          ),
        ),
      )

    yield* DurableRunner.register(BrainRun, (payload) =>
      DurableRunner.supervise(
        `brain:${payload.brainId}`,
        run(payload.brainId).pipe(Observability.Trace.brainRun, Effect.annotateSpans("ren.brain.id", payload.brainId)),
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

    const ensure = (brainId: Brain.ID) =>
      read(brainId).pipe(
        Effect.flatMap((row) => DurableRunner.ensure(BrainRun, { brainId, epoch: row.run_epoch })),
        Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
      )

    const touch = Effect.fnUntraced(function* (row: Row) {
      yield* update(row.id, { last_active_at: yield* now })
      yield* keepAlive(row, timing.idle).pipe(
        Effect.catchTag("SandboxProvider.Gone", () =>
          update(row.id, { phase: "replacing" }).pipe(Effect.andThen(ensure(row.id))),
        ),
        Effect.catch((error) => Effect.logWarning("keepAlive failed", error)),
      )
    })

    const access = Effect.fn("BrainLifecycle.access")(function* (brainId: Brain.ID) {
      const row = yield* read(brainId)
      const at = yield* now
      const target = targetOf(row)
      if (
        row.phase === "ready" &&
        Option.isSome(target) &&
        row.keep_alive_until &&
        row.keep_alive_until.getTime() > at.getTime()
      ) {
        if (row.keep_alive_until.getTime() - at.getTime() <= Duration.toMillis(timing.accessMargin))
          yield* touch({ ...row, keep_alive_until: null })
        else yield* touch(row)
        return { _tag: "Ready", target: target.value } as const
      }
      if (row.phase === "failed") return { _tag: "Failed", reason: row.failure ?? "The brain failed" } as const
      yield* ensure(brainId)
      const shown: Partial<Record<Brain.Phase, string>> = { ready: "resuming", capacity: "waiting for capacity" }
      return { _tag: "Starting", phase: shown[row.phase] ?? row.phase } as const
    })

    return Service.of({
      ensure,
      access,
      // oxlint-disable-next-line ren/no-comments -- HR12: reads the row only. It never calls ensure or touch, so it never resumes a paused sandbox or extends a keep-alive. A brain past its keep-alive may be paused, so it has no target.
      awake: Effect.fn("BrainLifecycle.awake")(function* (brainId: Brain.ID) {
        const row = yield* read(brainId)
        const at = yield* now
        return row.phase === "ready" && row.keep_alive_until && row.keep_alive_until.getTime() > at.getTime()
          ? targetOf(row)
          : Option.none()
      }),
      ready: Effect.fn("BrainLifecycle.ready")(function* (brainId: Brain.ID) {
        const wait = Effect.gen(function* () {
          const result = yield* access(brainId)
          if (result._tag === "Ready") return Option.some(result.target)
          if (result._tag === "Failed") return yield* new Unavailable({ message: result.reason })
          return Option.none<BrainClient.Target>()
        }).pipe(Effect.withTracerEnabled(false))
        return yield* wait.pipe(
          Effect.repeat({ until: Option.isSome, schedule: Schedule.spaced(timing.poll) }),
          Effect.flatMap((found) =>
            Option.isSome(found)
              ? Effect.succeed(found.value)
              : Effect.fail(new Unavailable({ message: `Brain ${brainId} did not get ready` })),
          ),
        )
      }),
      retry: Effect.fn("BrainLifecycle.retry")(function* (brainId: Brain.ID) {
        const row = yield* read(brainId)
        if (row.phase === "failed")
          yield* update(brainId, {
            phase: row.binding ? "resuming" : "creating",
            failures: 0,
            run_epoch: row.run_epoch + 1,
          })
        yield* ensure(brainId)
      }),
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
            (last) => at.getTime() - last.getTime() < Duration.toMillis(timing.stuck),
          )
        if (moving)
          yield* keepAlive(row, timing.busy).pipe(Effect.catch((error) => Effect.logWarning("keepAlive failed", error)))
      }),
      cleanup,
      check,
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
