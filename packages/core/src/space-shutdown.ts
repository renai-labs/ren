export * as SpaceShutdown from "./space-shutdown.js"

import { Database } from "@ren/db/database"
import { Space } from "@ren/schema/space"
import { and, eq, isNotNull } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { BrainHost } from "./brain-host.js"
import { DurableRunner } from "./durable-runner.js"
import { Environments } from "./environments.js"

// oxlint-disable-next-line ren/no-comments -- One run per shutdown: Space.shutdown takes the next epoch, so a later shutdown of the same space runs again.
const Run = DurableRunner.make("SpaceShutdown", {
  payload: { spaceId: Space.ID, epoch: Schema.Int },
  idempotencyKey: (payload) => `shutdown:${payload.spaceId}:${payload.epoch}`,
})

export interface Interface {
  // oxlint-disable-next-line ren/no-comments -- Starts the run of the shutdown that Space.shutdown marked; nothing when none is marked.
  readonly start: (spaceId: Space.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SpaceShutdown") {}

const spaces = Database.Schema.space

// oxlint-disable-next-line ren/no-comments -- A shutdown run stops all brains of the space at once (each within 60 seconds, then its generation is retired and its machine destroyed), then destroys every hand machine of the space. The report names what it could not confirm.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const brainHost = yield* BrainHost.Service
    const environments = yield* Environments.Service
    const engine = yield* WorkflowEngine.WorkflowEngine

    const shutdown = Effect.fnUntraced(function* (payload: typeof Run.payloadSchema.Type) {
      const found = (yield* database.db
        .select({ state: spaces.shutdown_state, epoch: spaces.shutdown_epoch })
        .from(spaces)
        .where(eq(spaces.id, payload.spaceId))
        .pipe(Effect.orDie)).at(0)
      if (found?.state !== "running" || found.epoch !== payload.epoch) return
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

    const start = (where: ReturnType<typeof and>) =>
      database.db
        .select({ spaceId: spaces.id, epoch: spaces.shutdown_epoch })
        .from(spaces)
        .where(where)
        .pipe(
          Effect.orDie,
          Effect.flatMap((running) =>
            Effect.forEach(running, (each) => DurableRunner.ensure(Run, each), { discard: true }),
          ),
          Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
        )

    // oxlint-disable-next-line ren/no-comments -- A shutdown that was marked but whose run never started, because Ren stopped between the two, starts when Ren starts.
    yield* start(isNotNull(spaces.shutdown_state))

    return Service.of({
      start: (spaceId) => start(and(eq(spaces.id, spaceId), isNotNull(spaces.shutdown_state))),
    })
  }),
)
