export * as Sync from "./sync.js"

import { OpenCodeSync } from "@ren/brain/opencode-sync"
import { Clock, Context, Duration, Effect, Layer, Option, Random, Ref } from "effect"
import { FetchHttpClient } from "effect/http"
import { HostToken } from "./host-token.js"

export interface Interface {
  readonly step: Effect.Effect<Option.Option<Duration.Duration>>
  readonly flush: Effect.Effect<boolean>
  readonly restore: <E, R>(
    input: Omit<OpenCodeSync.Restore<E, R>, "setRestoring">,
  ) => Effect.Effect<void, OpenCodeSync.SyncError | E, R>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/Sync") {}

const retryAfter = Duration.millis(250)

const backoff = { minimum: Duration.seconds(1), maximum: Duration.minutes(5) }

const alarmBudget = Duration.seconds(10)

const flushBudget = Duration.seconds(20)

export const make = Effect.fn("Sync.make")(function* (
  sync: Option.Option<OpenCodeSync.Interface>,
  setRestoring: (value: boolean) => Effect.Effect<void> = () => Effect.void,
) {
  if (Option.isNone(sync))
    return Service.of({ step: Effect.succeedNone, flush: Effect.succeed(false), restore: () => Effect.void })
  const opened = sync.value
  const failures = yield* Ref.make(0)
  const after = (step: OpenCodeSync.Step, now: number) =>
    step.throttledUntil ? Duration.millis(Math.max(0, step.throttledUntil - now)) : retryAfter

  return Service.of({
    restore: (input) => opened.restore({ ...input, setRestoring }),
    step: Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const step = yield* opened.step({ deadline: now + Duration.toMillis(alarmBudget) }).pipe(
        Effect.tapError((error) =>
          Effect.logWarning("The sync step failed. The alarm retries it with backoff.", error),
        ),
        Effect.option,
      )
      if (Option.isNone(step) || step.value.failed) {
        const count = yield* Ref.updateAndGet(failures, (value) => value + 1)
        const jitter = yield* Random.nextBetween(0.8, 1.2)
        const base = Duration.toMillis(backoff.minimum) * 2 ** Math.min(count - 1, 16)
        return Option.some(Duration.clamp(Duration.millis(base * jitter), backoff))
      }
      yield* Ref.set(failures, 0)
      if (step.value.drained) return Option.none()
      return Option.some(after(step.value, yield* Clock.currentTimeMillis))
    }).pipe(Effect.withSpan("Sync.step")),
    flush: Effect.gen(function* () {
      const deadline = (yield* Clock.currentTimeMillis) + Duration.toMillis(flushBudget)
      let step = yield* opened.step({ deadline })
      while (!step.drained && !step.failed) {
        const now = yield* Clock.currentTimeMillis
        const wait = after(step, now)
        if (now + Duration.toMillis(wait) >= deadline) return false
        yield* Effect.sleep(wait)
        step = yield* opened.step({ deadline })
      }
      return step.drained
    }).pipe(
      Effect.catchTag("OpenCodeSync.SyncError", (error) =>
        Effect.logWarning("The sync flush stopped", error).pipe(Effect.as(false)),
      ),
      Effect.withSpan("Sync.flush"),
    ),
  })
})

export const layer = (storage: DurableObjectStorage, url: string | undefined) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      if (!url) return yield* make(Option.none())
      const hostToken = yield* HostToken.Service
      const opened = yield* OpenCodeSync.make({
        url,
        token: hostToken.current.pipe(Effect.map(Option.getOrElse(() => ""))),
        reader: { read: (read) => read((query, ...bindings) => storage.sql.exec(query, ...bindings)) },
        restoring: Effect.promise(async () => (await storage.get<boolean>("ren:restoring")) ?? false),
      }).pipe(Effect.provide(FetchHttpClient.layer))
      return yield* make(Option.some(opened), (value) => Effect.promise(() => storage.put("ren:restoring", value)))
    }),
  )
