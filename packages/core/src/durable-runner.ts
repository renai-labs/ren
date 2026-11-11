export * as DurableRunner from "./durable-runner.js"

import { Duration, Effect, Layer, Schedule, type Schema } from "effect"
import { ClusterWorkflowEngine, SingleRunner } from "effect/cluster"
import { Digest } from "effect/crypto"
import { SqlClient } from "effect/sql"
import { Workflow, WorkflowEngine } from "effect/workflow"

// oxlint-disable-next-line ren/no-comments -- The names of Ren's runs. make adds each name when its module loads, before any layer starts, so purge sees every run; it deletes rows of these runs only.
const names = new Set<string>()

// oxlint-disable-next-line ren/no-comments -- A run is named and keyed: one execution per key at a time, also across Ren replicas. A key that finished does not run again, so a run that must run again puts a counter in its key.
export type Run<Name extends string, Payload extends Workflow.AnyStructSchema> = Workflow.Workflow<
  Name,
  Payload,
  Schema.Void,
  Schema.Never
>

export const make: typeof Workflow.make = (tag, options) => {
  names.add(tag)
  return Workflow.make(tag, options)
}

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

// oxlint-disable-next-line ren/no-comments -- Effect's cluster engine keeps the message and reply rows of a run after it ends. This deletes the rows of each run of Ren's names whose messages are all processed and were last read before cutoff, and only the replies of the messages it deletes. Every key is used once (a time slot, a day, an id, or an epoch that moves on when its run ends), so no deleted key runs again. Rows of other entity types, and of runs still in progress, stay.
export const purge = Effect.fnUntraced(function* (sql: SqlClient.SqlClient, cutoff: Date) {
  const types = [...names].map((name) => `Workflow/${name}`)
  if (types.length === 0) return 0
  const deleted = yield* sql<{ readonly id: string }>`
    with ended as (
      select entity_type, entity_id from cluster_messages
      where entity_type in ${sql.in(types)}
      group by entity_type, entity_id
      having bool_and(processed) and max(last_read) < ${cutoff}
    ), gone as (
      delete from cluster_messages as message using ended
      where message.entity_type = ended.entity_type and message.entity_id = ended.entity_id
      returning message.id
    ), replies as (
      delete from cluster_replies as reply using gone where reply.request_id = gone.id
    )
    select id::text from gone`
  return deleted.length
})

export const ensure = <Name extends string, Payload extends Workflow.AnyStructSchema>(
  run: Run<Name, Payload>,
  payload: Payload["~type.make.in"],
) => run.execute(payload, { discard: true }).pipe(Effect.asVoid)

// oxlint-disable-next-line ren/no-comments -- Starts the run of this key if it does not run, and waits for its end. A caller that stops waiting does not stop the run.
export const join = <Name extends string, Payload extends Workflow.AnyStructSchema>(
  run: Run<Name, Payload>,
  payload: Payload["~type.make.in"],
) => run.execute(payload).pipe(Effect.asVoid)

export const supervised = <Name extends string, Payload extends Workflow.AnyStructSchema, E>(
  run: Run<Name, Payload>,
  handler: (payload: Payload["Type"]) => Effect.Effect<void, E>,
) =>
  Effect.gen(function* () {
    const engine = yield* WorkflowEngine.WorkflowEngine
    yield* register(run, (payload) => supervise(run.idempotencyKey(payload), handler(payload)))
    return (payload: Payload["~type.make.in"]) =>
      ensure(run, payload).pipe(Effect.provideService(WorkflowEngine.WorkflowEngine, engine))
  })

export const layerMemory = WorkflowEngine.layerMemory

export const layerEffect = ClusterWorkflowEngine.layer.pipe(
  Layer.provideMerge(SingleRunner.layer()),
  Layer.provide(Digest.layerWebCrypto),
)
