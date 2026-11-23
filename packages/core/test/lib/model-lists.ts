export * as ModelListsTest from "./model-lists.js"

import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Queue } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { BrainPush } from "../../src/brain-push.js"
import { ModelGateway } from "../../src/model-gateway.js"
import { ModelLists } from "../../src/model-lists.js"

// oxlint-disable-next-line ren/no-comments -- The brain pushes sent since the last `collect`, in order: a barrier notify marks the end.
export const listening = Effect.gen(function* () {
  const pg = yield* PgClient.PgClient
  const notifications = yield* pg.listen(BrainPush.channel)
  const until = (seen: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, SqlError> =>
    Queue.take(notifications).pipe(
      Effect.flatMap((next) => (next.payload === "barrier" ? Effect.succeed(seen) : until([...seen, next.payload]))),
    )
  const awaitPayload = (payload: string): Effect.Effect<void, SqlError> =>
    Queue.take(notifications).pipe(
      Effect.flatMap((next) => (next.payload === payload ? Effect.void : awaitPayload(payload))),
    )
  return {
    collect: pg.notify(BrainPush.channel, "barrier").pipe(Effect.andThen(until([])), Effect.orDie),
    awaitPayload: (payload: string) => awaitPayload(payload).pipe(Effect.orDie),
  }
})

export const layer = (gateway: ModelGateway.Gateway) =>
  ModelLists.layer.pipe(Layer.provideMerge(ModelGateway.layer([Effect.succeed(gateway)])))
