export * as DurableRunner from "./durable-runner.js"

import { Duration, Effect, Layer, Schedule, type Schema } from "effect"
import { ClusterWorkflowEngine, SingleRunner } from "effect/cluster"
import { Workflow, WorkflowEngine } from "effect/workflow"

// oxlint-disable-next-line ren/no-comments -- A run is named and keyed: one execution per key at a time, also across Ren replicas. A key that finished does not run again, so a run that must run again puts a counter in its key.
export type Run<Name extends string, Payload extends Workflow.AnyStructSchema> = Workflow.Workflow<
  Name,
  Payload,
  Schema.Void,
  Schema.Never
>

export const make = Workflow.make

export const retry = Schedule.exponential(Duration.seconds(1)).pipe(
  Schedule.modifyDelay((metadata) => Effect.succeed(Duration.min(metadata.duration, Duration.minutes(1)))),
)

export const supervise = <E>(key: string, run: Effect.Effect<void, E>) =>
  run.pipe(
    Effect.tapError((error) => Effect.logWarning(`Run ${key} failed; it retries`, error)),
    Effect.retry(retry),
    Effect.catchCause((cause) => Effect.logError(`Run ${key} stopped`, cause)),
    Effect.annotateLogs({ run: key }),
  )

export const register = <Name extends string, Payload extends Workflow.AnyStructSchema>(
  run: Run<Name, Payload>,
  handler: (payload: Payload["Type"]) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const engine = yield* WorkflowEngine.WorkflowEngine
    yield* engine.register(run, (payload) => handler(payload))
  })

export const ensure = <Name extends string, Payload extends Workflow.AnyStructSchema>(
  run: Run<Name, Payload>,
  payload: Payload["~type.make.in"],
) => run.execute(payload, { discard: true }).pipe(Effect.asVoid)

export const layerMemory = WorkflowEngine.layerMemory

export const layerEffect = ClusterWorkflowEngine.layer.pipe(Layer.provideMerge(SingleRunner.layer()))
