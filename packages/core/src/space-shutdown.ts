export * as SpaceShutdown from "./space-shutdown.js"

import { Database } from "@ren/db/database"
import { Space } from "@ren/schema/space"
import { and, eq, isNotNull } from "drizzle-orm"
import { Config, DateTime, Duration, Effect, Layer, Schedule, Schema } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { BrainHost } from "./brain-host.js"
import { DurableRunner } from "./durable-runner.js"
import { Environments } from "./environments.js"

// oxlint-disable-next-line ren/no-comments -- One run per shutdown: Space.shutdown takes the next epoch, so a later shutdown of the same space runs again.
const Run = DurableRunner.make("SpaceShutdown", {
  payload: { spaceId: Space.ID, epoch: Schema.Int },
  idempotencyKey: (payload) => `shutdown:${payload.spaceId}:${payload.epoch}`,
})

const spaces = Database.Schema.space

// oxlint-disable-next-line ren/no-comments -- Runs each shutdown that Space.shutdown marks: all brains of the space at once (each stops within 60 seconds, then its generation is retired and its machine destroyed), then every hand machine of the space. The report names what it could not confirm.
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const database = yield* Database.Service
    const brainHost = yield* BrainHost.Service
    const environments = yield* Environments.Service
    const engine = yield* WorkflowEngine.WorkflowEngine
    // oxlint-disable-next-line ren/no-comments -- How often each Ren looks for a shutdown that a person asked for, also after a restart.
    const pollEvery = yield* Config.Duration("SPACE_SHUTDOWN_POLL").pipe(Config.withDefault(Duration.seconds(2)))

    const shutdown = Effect.fnUntraced(function* (payload: typeof Run.payloadSchema.Type) {
      const space = (yield* database.db
        .select({ state: spaces.shutdown_state, epoch: spaces.shutdown_epoch })
        .from(spaces)
        .where(eq(spaces.id, payload.spaceId))
        .pipe(Effect.orDie)).at(0)
      if (space?.state !== "running" || space.epoch !== payload.epoch) return
      const brains = yield* database.db
        .select({ id: Database.Schema.brain.id })
        .from(Database.Schema.brain)
        .where(eq(Database.Schema.brain.space_id, payload.spaceId))
        .pipe(Effect.orDie)
      const stopped = yield* Effect.forEach(brains, (brain) => brainHost.stop(brain.id), { concurrency: "unbounded" })
      const destroyed = yield* environments.shutdown(payload.spaceId)
      const report = {
        finishedAt: DateTime.formatIso(yield* DateTime.now),
        problems: [...stopped.flat(), ...destroyed],
      }
      yield* database.db
        .update(spaces)
        .set({ shutdown_state: null, shutdown_report: report })
        .where(and(eq(spaces.id, payload.spaceId), eq(spaces.shutdown_epoch, payload.epoch)))
        .pipe(Effect.orDie)
    })

    yield* DurableRunner.register(Run, (payload) =>
      DurableRunner.supervise(`shutdown:${payload.spaceId}:${payload.epoch}`, shutdown(payload)),
    )

    yield* database.db
      .select({ spaceId: spaces.id, epoch: spaces.shutdown_epoch })
      .from(spaces)
      .where(isNotNull(spaces.shutdown_state))
      .pipe(
        Effect.orDie,
        Effect.flatMap((running) =>
          Effect.forEach(running, (each) => DurableRunner.ensure(Run, each), { discard: true }),
        ),
        Effect.repeat(Schedule.spaced(pollEvery)),
        Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
        Effect.withErrorReporting,
        Effect.forkScoped,
      )
  }),
)
