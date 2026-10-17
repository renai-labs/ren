import { expect } from "bun:test"
import { OpenCodeSync } from "@ren/brain/opencode-sync"
import { testEffect } from "@ren/executor/testing"
import { Duration, Effect, Fiber, Layer, Option, Random } from "effect"
import { TestClock } from "effect/testing"
import { Sync } from "../src/sync.js"

const it = testEffect(Layer.empty)

const unavailable = new OpenCodeSync.SyncError({ reason: "unavailable", message: "Ren is down" })

const scripted = Effect.fnUntraced(function* () {
  const steps: Array<Effect.Effect<OpenCodeSync.Step, OpenCodeSync.SyncError>> = []
  const sync = yield* Sync.make(
    Option.some({
      step: () => Effect.suspend(() => steps.shift() ?? Effect.succeed({ drained: true })),
      exclusive: (effect) => effect,
      restore: () => Effect.void,
    }),
  )
  const next = (step: Effect.Effect<OpenCodeSync.Step, OpenCodeSync.SyncError>) =>
    Effect.suspend(() => {
      steps.push(step)
      return sync.step.pipe(Effect.map(Option.map(Duration.toMillis)))
    })
  return { sync, steps, next }
})

it.effect(
  "sync steps that fail set the next alarm with exponential backoff and jitter from 1 s to 5 min, and a step that succeeds resets the backoff",
  () =>
    Effect.gen(function* () {
      const subject = yield* scripted()
      const failures = [
        ...Array.from({ length: 6 }, () => Effect.fail(unavailable)),
        ...Array.from({ length: 6 }, () => Effect.succeed({ drained: false, failed: true })),
      ]
      const delays = yield* Effect.forEach(failures, subject.next)
      expect(yield* subject.next(Effect.succeed({ drained: true }))).toEqual(Option.none())
      const reset = yield* subject.next(Effect.fail(unavailable))
      const clamp = (ms: number) => Math.min(300_000, Math.max(1000, ms))
      const bases = [...Array.from({ length: 12 }, (_, index) => 1000 * 2 ** index), 1000]
      expect(
        [...delays, reset].map((delay, index) => {
          const base = bases[index] ?? 0
          return Option.exists(delay, (ms) => ms >= clamp(0.8 * base) && ms <= clamp(1.2 * base))
        }),
      ).toEqual(bases.map(() => true))
      expect(delays.slice(9)).toEqual([300_000, 300_000, 300_000].map(Option.some))
      expect(delays.slice(0, 8).some((delay, index) => !Option.contains(delay, bases[index] ?? 0))).toBe(true)
    }).pipe(Random.withSeed("backoff")),
)

it.effect("a step that is not drained retries in 250 ms, or when the O4 limit lets the first busy session pass", () =>
  Effect.gen(function* () {
    const subject = yield* scripted()
    expect(yield* subject.next(Effect.succeed({ drained: false }))).toEqual(Option.some(250))
    expect(yield* subject.next(Effect.succeed({ drained: false, throttledUntil: 120_000 }))).toEqual(
      Option.some(120_000),
    )
  }),
)

it.effect(
  "a flush retries until it drains, and stops at a failed pass or at a busy session held past its deadline",
  () =>
    Effect.gen(function* () {
      const subject = yield* scripted()
      subject.steps.push(Effect.succeed({ drained: false, failed: true }))
      expect(yield* subject.sync.flush).toBe(false)
      subject.steps.push(
        Effect.succeed({ drained: false, throttledUntil: Duration.toMillis(OpenCodeSync.busyInterval) }),
      )
      expect(yield* subject.sync.flush).toBe(false)
      subject.steps.push(Effect.succeed({ drained: false }))
      const flushing = yield* Effect.forkChild(subject.sync.flush)
      yield* TestClock.adjust(250)
      expect(yield* Fiber.join(flushing)).toBe(true)
      expect(subject.steps).toEqual([])
    }),
)
