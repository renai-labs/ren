export * as BrainLifecycle from "./brain-lifecycle.js"

import { Database } from "@ren/db/database"
import type { PullSession } from "@ren/host-api/ren-host-api"
import { Brain } from "@ren/schema/brain"
import { Signature } from "@ren/schema/signature"
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { Clock, Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { BrainClient } from "./brain-client.js"
import { DurableRunner } from "./durable-runner.js"
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
  readonly retry: (brainId: Brain.ID) => Effect.Effect<void>
  readonly observe: (brainId: Brain.ID, sessions: ReadonlyArray<PullSession>) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/BrainLifecycle") {}

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

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const provider = yield* SandboxProvider.Service
    const client = yield* BrainClient.Service
    const runner = yield* DurableRunner.Service

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

    const env = (row: Row) => ({
      REN_URL: client.renUrl,
      REN_BRAIN_ID: row.id,
      REN_BRAIN_GENERATION: String(row.generation),
      BRAIN_PUBLIC_KEYS: Schema.encodeSync(Signature.PublicKeys)(client.publicKeys),
    })

    const create = Effect.fnUntraced(function* (row: Row) {
      const created = yield* provider.create({ brainId: row.id, generation: row.generation, env: env(row) }).pipe(
        Effect.map(Option.some),
        Effect.catchTag("SandboxProvider.Capacity", (error) =>
          Effect.logWarning(`Waiting for capacity: ${error.message}`).pipe(
            Effect.andThen(Effect.sleep(error.retryAfter)),
            Effect.as(Option.none<SandboxProvider.Created>()),
          ),
        ),
      )
      if (Option.isNone(created)) return false
      yield* update(row.id, {
        provider: provider.kind,
        binding: created.value.binding,
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
      const state = yield* waitFor(api.brain["brain.state"](), timing.boot)
      if (Option.isNone(state)) {
        if (row.binding) yield* provider.destroy(row.binding).pipe(Effect.ignore)
        yield* fail(row, `The brain did not answer within ${Duration.format(timing.boot)}`, "creating")
        yield* update(row.id, { binding: null, url: null })
        return false
      }
      yield* update(row.id, { phase: "ready", failures: 0, failure: null })
      yield* keepAlive(yield* read(row.id), timing.idle)
      return true
    })

    const resume = Effect.fnUntraced(function* (row: Row) {
      if (!row.binding) return yield* update(row.id, { phase: "creating" }).pipe(Effect.as(false))
      const connected = yield* provider.connect(row.binding).pipe(
        Effect.map(Option.some),
        Effect.catchTag("SandboxProvider.Gone", () => Effect.succeedNone),
        Effect.catchTag("SandboxProvider.Capacity", (error) =>
          Effect.sleep(error.retryAfter).pipe(
            Effect.andThen(Effect.fail(new SandboxProvider.Failed({ message: error.message }))),
          ),
        ),
      )
      if (Option.isNone(connected)) return yield* update(row.id, { phase: "replacing" }).pipe(Effect.as(false))
      yield* update(row.id, { url: connected.value.url, keep_alive_until: null })
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
        Effect.timeoutOption(timing.wake),
      )
      if (Option.isNone(woke)) {
        yield* Effect.logWarning(`Brain ${row.id} did not confirm its wake in time; Ren replaces it`)
        return yield* update(row.id, { phase: "replacing" }).pipe(Effect.as(false))
      }
      yield* update(row.id, { phase: "ready", failures: 0, failure: null })
      return true
    })

    const replace = Effect.fnUntraced(function* (row: Row) {
      yield* database
        .transaction((transaction) =>
          Effect.gen(function* () {
            const at = yield* now
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
            const busy = transaction
              .select({ id: Database.Schema.agent_session.id })
              .from(Database.Schema.agent_session)
              .where(eq(Database.Schema.agent_session.brain_id, row.id))
            yield* transaction
              .update(Database.Schema.opencode_session)
              .set({ time_suspended: null, idle_outcome: "interrupted", time_idle: at.getTime() })
              .where(
                and(
                  inArray(Database.Schema.opencode_session.session_id, busy),
                  isNotNull(Database.Schema.opencode_session.time_suspended),
                ),
              )
          }),
        )
        .pipe(Effect.orDie)
      if (row.binding)
        yield* provider
          .destroy(row.binding)
          .pipe(Effect.catch((error) => Effect.logWarning("Destroying the replaced sandbox failed", error)))
      return false
    })

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
    } satisfies Record<Brain.Phase, (row: Row) => Effect.Effect<boolean, unknown>>

    const step = Effect.fn("BrainLifecycle.step")(function* (brainId: Brain.ID) {
      const row = yield* read(brainId)
      return yield* phases[row.phase](row)
    })

    const run = (brainId: Brain.ID) =>
      Effect.gen(function* () {
        while (!(yield* step(brainId))) yield* Effect.yieldNow
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

    const ensure = (brainId: Brain.ID) => runner.ensure(`brain:${brainId}`, run(brainId))

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
      const phase = row.phase === "ready" ? "resuming" : row.phase
      return { _tag: "Starting", phase } as const
    })

    return Service.of({
      ensure,
      access,
      ready: Effect.fn("BrainLifecycle.ready")(function* (brainId: Brain.ID) {
        const wait = Effect.gen(function* () {
          const result = yield* access(brainId)
          if (result._tag === "Ready") return Option.some(result.target)
          if (result._tag === "Failed") return yield* new Unavailable({ message: result.reason })
          return Option.none<BrainClient.Target>()
        })
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
          yield* update(brainId, { phase: row.binding ? "resuming" : "creating", failures: 0 })
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
    })
  }),
)
