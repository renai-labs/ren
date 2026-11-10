import { describe, expect } from "bun:test"
import { Task } from "@ren/schema/task"
import { Deferred, Effect, Layer, Ref } from "effect"
import { TaskCardSync } from "../src/task-card-sync.js"
import { testEffect } from "./lib/effect.js"

const it = testEffect(Layer.empty)

describe("TaskCardSync", () => {
  it.effect("refreshes during a sync collapse into one more sync, and a later refresh starts a new one", () =>
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const refresh = TaskCardSync.make(scope, "cards")
      const taskId = Task.ID.create()
      const other = Task.ID.create()
      const runs = yield* Ref.make<ReadonlyArray<Task.ID>>([])
      const gate = yield* Deferred.make<void>()
      const third = yield* Deferred.make<void>()
      const fourth = yield* Deferred.make<void>()
      const reached = new Map([
        [3, third],
        [4, fourth],
      ])
      const sync = (id: Task.ID) =>
        Deferred.await(gate).pipe(
          Effect.andThen(Ref.updateAndGet(runs, (seen) => [...seen, id])),
          Effect.flatMap((seen) => {
            const done = reached.get(seen.length)
            return done ? Deferred.succeed(done, undefined) : Effect.void
          }),
        )
      yield* refresh(taskId, sync(taskId))
      yield* refresh(taskId, sync(taskId))
      yield* refresh(taskId, sync(taskId))
      yield* refresh(other, sync(other))
      yield* Deferred.succeed(gate, undefined)
      yield* Deferred.await(third)
      expect((yield* Ref.get(runs)).toSorted()).toEqual([taskId, taskId, other].toSorted())
      yield* refresh(taskId, sync(taskId))
      yield* Deferred.await(fourth)
      expect(yield* Ref.get(runs)).toHaveLength(4)
    }),
  )
})
