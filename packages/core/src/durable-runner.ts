export * as DurableRunner from "./durable-runner.js"

import { Context, Duration, Effect, FiberMap, Layer, Schedule } from "effect"

export interface Interface {
  readonly ensure: <E>(key: string, run: Effect.Effect<void, E>) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/DurableRunner") {}

const retry = Schedule.exponential(Duration.seconds(1)).pipe(
  Schedule.modifyDelay((metadata) => Effect.succeed(Duration.min(metadata.duration, Duration.minutes(1)))),
)

export const layerMemory = Layer.effect(
  Service,
  Effect.gen(function* () {
    const runs = yield* FiberMap.make<string>()
    return Service.of({
      ensure: (key, run) =>
        FiberMap.run(
          runs,
          key,
          run.pipe(
            Effect.tapError((error) => Effect.logWarning(`Run ${key} failed; it retries`, error)),
            Effect.retry(retry),
            Effect.catchCause((cause) => Effect.logError(`Run ${key} stopped`, cause)),
            Effect.annotateLogs({ run: key }),
          ),
          { onlyIfMissing: true },
        ).pipe(Effect.asVoid),
    })
  }),
)
