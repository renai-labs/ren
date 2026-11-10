export * as TaskCardSync from "./task-card-sync.js"

import type { Task } from "@ren/schema/task"
import { Effect, type Scope } from "effect"

export const make = (scope: Scope.Scope, cards: string) => {
  const running = new Map<Task.ID, { dirty: boolean }>()
  return (taskId: Task.ID, sync: Effect.Effect<void, unknown>) =>
    Effect.suspend(() => {
      const current = running.get(taskId)
      if (current) {
        current.dirty = true
        return Effect.void
      }
      const started = { dirty: false }
      running.set(taskId, started)
      const failed = (cause: unknown) => Effect.logWarning(`The ${cards} of ${taskId} were not written`, cause)
      const again: Effect.Effect<void> = Effect.suspend(() => {
        if (!started.dirty) return Effect.void
        started.dirty = false
        return sync.pipe(Effect.catchCause(failed), Effect.andThen(again))
      })
      return sync.pipe(
        Effect.catchCause(failed),
        Effect.andThen(again),
        Effect.ensuring(
          Effect.sync(() => {
            if (running.get(taskId) === started) running.delete(taskId)
          }),
        ),
        Effect.forkIn(scope),
        Effect.asVoid,
      )
    })
}
