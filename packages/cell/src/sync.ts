export * as Sync from "./sync.js"

import { OpenCodeSync } from "@ren/brain/opencode-sync"
import { Session } from "@ren/schema/session"
import { Clock, Context, Duration, Effect, Layer, Option, Random, Ref, Schema, type Scope } from "effect"
import { FetchHttpClient } from "effect/http"
import { BrainStorage } from "./brain-storage.js"
import { HostToken } from "./host-token.js"
import { SyncClient } from "./sync-client.js"
import { RenAddress } from "./ren-address.js"

export interface Interface {
  readonly step: Effect.Effect<Option.Option<Duration.Duration>>
  readonly flush: Effect.Effect<boolean>
  readonly restore: <E, R>(input: OpenCodeSync.Restore<E, R>) => Effect.Effect<void, OpenCodeSync.SyncError | E, R>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/Sync") {}

const retryAfter = Duration.millis(250)

const backoff = { minimum: Duration.seconds(1), maximum: Duration.minutes(5) }

const alarmBudget = Duration.seconds(10)

const flushBudget = Duration.seconds(20)

export const make = Effect.fn("Sync.make")(function* (sync: Option.Option<OpenCodeSync.Interface>) {
  if (Option.isNone(sync))
    return Service.of({ step: Effect.succeedNone, flush: Effect.succeed(false), restore: () => Effect.void })
  const opened = sync.value
  const failures = yield* Ref.make(0)
  const after = (step: OpenCodeSync.Step, now: number) =>
    step.throttledUntil ? Duration.millis(Math.max(0, step.throttledUntil - now)) : retryAfter

  return Service.of({
    restore: opened.restore,
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

const restoringKey = "ren:restoring"

const Restoring = Schema.fromJsonString(Schema.Array(Session.ID))

export const layerWith = (reader: Effect.Effect<OpenCodeSync.Reader, never, Scope.Scope>, url: string | undefined) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      if (!url) return yield* make(Option.none())
      const hostToken = yield* HostToken.Service
      const storage = yield* BrainStorage.Service
      const restoring = Effect.promise(() => storage.get(restoringKey)).pipe(
        Effect.map((stored) => new Set(Schema.decodeUnknownOption(Restoring)(stored).pipe(Option.getOrElse(() => [])))),
      )
      const opened = yield* OpenCodeSync.make({
        remote: yield* SyncClient.make(url, hostToken.current.pipe(Effect.map(Option.getOrElse(() => "")))).pipe(
          Effect.provide(RenAddress.http.pipe(Layer.provide(FetchHttpClient.layer))),
        ),
        reader: yield* reader,
        restoring,
        mark: (id, state) =>
          restoring.pipe(
            Effect.map((current) => [
              ...[...current].filter((each) => each !== id),
              ...(state.isRestoring ? [id] : []),
            ]),
            Effect.flatMap((next) =>
              Effect.promise(() => storage.put(restoringKey, Schema.encodeSync(Restoring)(next))),
            ),
          ),
      })
      return yield* make(Option.some(opened))
    }),
  )

export const layer = (storage: DurableObjectStorage, url: string | undefined) =>
  layerWith(Effect.succeed({ read: (read) => read((query, ...bindings) => storage.sql.exec(query, ...bindings)) }), url)
