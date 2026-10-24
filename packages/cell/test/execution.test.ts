import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { OpenCodeExecution } from "../src/harness/opencode/execution.js"

const it = testEffect(Layer.empty)

it.live("a failed replacement fails neither its offer nor the execution waiting behind it", () =>
  Effect.gen(function* () {
    const boundary = OpenCodeExecution.make().get({ directory: "/workspace" })
    const finish = yield* Deferred.make<void>()
    const replacing = yield* boundary
      .offer(Deferred.await(finish).pipe(Effect.andThen(Effect.die(new Error("Replacement failed")))))
      .pipe(Effect.forkScoped({ startImmediately: true }))
    const waiting = yield* boundary.run(Effect.void).pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.succeed(finish, undefined)
    yield* Fiber.join(replacing)
    yield* Fiber.join(waiting).pipe(Effect.timeout("1 second"))
  }),
)

it.live("execution that ends by applying a failed replacement still succeeds", () =>
  Effect.gen(function* () {
    const boundary = OpenCodeExecution.make().get({ directory: "/workspace" })
    const result = yield* boundary.run(
      boundary.offer(Effect.die(new Error("Replacement failed"))).pipe(Effect.as("finished")),
    )
    expect(result).toBe("finished")
  }),
)

it.live("a pending config lets child work finish before the parent releases the old config", () =>
  Effect.gen(function* () {
    const boundary = OpenCodeExecution.make().get({ directory: "/workspace" })
    const applied = yield* Deferred.make<void>()
    yield* boundary
      .run(
        boundary
          .offer(Deferred.succeed(applied, undefined).pipe(Effect.asVoid))
          .pipe(
            Effect.andThen(boundary.run(Effect.void)),
            Effect.andThen(Effect.sync(() => expect(Deferred.isDoneUnsafe(applied)).toBe(false))),
          ),
      )
      .pipe(Effect.timeout("1 second"))
    expect(yield* Deferred.isDone(applied)).toBe(true)
  }),
)

it.live("canceling execution blocked on admission settles before the replacement finishes", () =>
  Effect.gen(function* () {
    const boundary = OpenCodeExecution.make().get({ directory: "/workspace" })
    const release = yield* Deferred.make<void>()
    const replacing = yield* boundary.offer(Deferred.await(release)).pipe(Effect.forkScoped({ startImmediately: true }))
    const work = yield* boundary
      .run(Effect.die(new Error("Canceled execution must not start")))
      .pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
    yield* Fiber.interrupt(work).pipe(Effect.timeout("1 second"))
    expect(yield* Deferred.isDone(release)).toBe(false)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(replacing)
    const running = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    const applied = yield* Deferred.make<void>()
    const next = yield* boundary
      .run(Deferred.succeed(running, undefined).pipe(Effect.andThen(Deferred.await(finish))))
      .pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Deferred.await(running)
    yield* boundary.offer(Deferred.succeed(applied, undefined).pipe(Effect.asVoid))
    expect(yield* Deferred.isDone(applied)).toBe(false)
    yield* Deferred.succeed(finish, undefined)
    yield* Fiber.join(next)
    expect(yield* Deferred.isDone(applied)).toBe(true)
  }),
)
