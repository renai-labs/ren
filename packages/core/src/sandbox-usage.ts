export * as SandboxUsage from "./sandbox-usage.js"

import { Database } from "@ren/db/database"
import { Workload } from "@ren/schema/workload"
import { desc, eq } from "drizzle-orm"
import { Array, Clock, Context, DateTime, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { DurableRunner } from "./durable-runner.js"
import { SandboxProvider } from "./sandbox-provider.js"
import { Usage } from "./usage.js"

export interface Interface {
  readonly sweep: Effect.Effect<void, SandboxProvider.Failed | Usage.Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SandboxUsage") {}

export const every = Duration.minutes(5)

// oxlint-disable-next-line ren/no-comments -- A span can reach the provider's list a little after it ended, so each sweep reads again from 10 minutes before the newest stored span; a repeat is ignored.
export const overlap = Duration.minutes(10)

const SweepRun = DurableRunner.make("SandboxUsage", {
  payload: { slot: Schema.String },
  idempotencyKey: (payload) => `sandbox-usage:${payload.slot}`,
})

const events = Database.Schema.usage_event

// oxlint-disable-next-line ren/no-comments -- The sandbox provider measures each span in which a sandbox ran; Ren stores each span as one sandbox.compute event (usage spec §10). It keeps no state between sweeps: the newest stored span says where to read from.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const provider = yield* SandboxProvider.Service
    const usage = yield* Usage.Service
    const engine = yield* WorkflowEngine.WorkflowEngine

    const sweep = Effect.gen(function* () {
      const newest = yield* database.db
        .select({ time: events.time })
        .from(events)
        .where(eq(events.source, provider.kind))
        .orderBy(desc(events.time))
        .limit(1)
        .pipe(Effect.orDie)
      const since = Option.map(Option.fromNullishOr(newest.at(0)), (row) =>
        DateTime.subtractDuration(DateTime.fromDateUnsafe(row.time), overlap),
      )
      const metered = yield* provider.metered(since)
      yield* Effect.forEach(
        Array.chunksOf(
          metered.map((span): Usage.Event => ({
            source: provider.kind,
            id: span.id,
            type: "sandbox.compute",
            time: span.endedAt,
            workload: Workload.key({ kind: "brain", id: span.brainId, generation: span.generation }),
            organization: span.organizationId,
            brain: span.brainId,
            space: span.spaceId,
            payer: "ren",
            provider: provider.kind,
            cost_micro_usd: span.costMicroUsd,
            data: {
              sandbox_id: span.sandboxId,
              duration_ms: span.durationMs,
              vcpu_ms: span.vcpuMs,
              memory_mib_ms: span.memoryMibMs,
              end: span.end,
            },
          })),
          500,
        ),
        (batch) => usage.record(batch),
        { discard: true },
      )
    }).pipe(Effect.withSpan("SandboxUsage.sweep"))

    yield* DurableRunner.register(SweepRun, (payload) =>
      DurableRunner.supervise(`sandbox-usage:${payload.slot}`, sweep),
    )
    yield* Effect.gen(function* () {
      const slot = Math.floor((yield* Clock.currentTimeMillis) / Duration.toMillis(every))
      yield* DurableRunner.ensure(SweepRun, { slot: String(slot) })
    }).pipe(
      Effect.repeat(Schedule.spaced(every)),
      Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
      Effect.forkScoped,
    )

    return Service.of({ sweep })
  }),
)
