import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { OpenCodeExecution } from "../src/harness/opencode/execution.js"

const it = testEffect(Layer.empty)

it.live("a drain waits for the boot work that runs when it starts, also when that work fails", () =>
  Effect.gen(function* () {
    const boundary = OpenCodeExecution.make().get({ directory: "/workspace" })
    const finish = yield* Deferred.make<void>()
    const booting = yield* boundary
      .holdUntil(Deferred.await(finish).pipe(Effect.andThen(Effect.die(new Error("Boot work failed")))))
      .pipe(Effect.forkScoped({ startImmediately: true }))
    const drained = yield* Deferred.make<void>()
    const waiting = yield* boundary
      .run(Deferred.succeed(drained, undefined))
      .pipe(Effect.forkScoped({ startImmediately: true }))
    yield* Effect.yieldNow
    expect(yield* Deferred.isDone(drained)).toBe(false)
    yield* Deferred.succeed(finish, undefined)
    yield* Fiber.join(booting)
    yield* Fiber.join(waiting)
    expect(yield* boundary.run(Effect.succeed("later"))).toBe("later")
  }),
)
