export * as Scheduler from "./scheduler.js"

import { Context, Duration, Effect, Layer, Queue, type Scope } from "effect"

export interface Interface {
  readonly job: (name: string, run: Effect.Effect<Duration.Duration>) => Effect.Effect<void, never, Scope.Scope>
  readonly trigger: (name: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/Scheduler") {}

export const layer = Layer.sync(Service, () => {
  const triggers = new Map<string, Queue.Queue<void>>()
  return Service.of({
    job: Effect.fnUntraced(function* (name, run) {
      const queue = yield* Queue.sliding<void>(1)
      triggers.set(name, queue)
      yield* run.pipe(
        Effect.catchCause((cause) =>
          Effect.logError(`Job ${name} failed`, cause).pipe(Effect.as(Duration.seconds(30))),
        ),
        Effect.flatMap((delay) => Effect.raceFirst(Effect.sleep(delay), Queue.take(queue))),
        Effect.forever,
        Effect.forkScoped,
      )
    }),
    trigger: (name) => {
      const queue = triggers.get(name)
      return queue ? Queue.offer(queue, undefined).pipe(Effect.asVoid) : Effect.void
    },
  })
})
