export * as Testing from "./effect.js"

import { test } from "bun:test"
import { Effect, Layer, type Scope } from "effect"
import { TestClock } from "effect/testing"

export const testEffect = <R, E>(layer: Layer.Layer<R, E>) => ({
  effect: <A, E2>(name: string, body: () => Effect.Effect<A, E2, R | Scope.Scope>) =>
    test(name, () =>
      body().pipe(Effect.scoped, Effect.provide(layer), Effect.provide(TestClock.layer()), Effect.runPromise),
    ),
  live: <A, E2>(name: string, body: () => Effect.Effect<A, E2, R | Scope.Scope>, timeout?: number) =>
    test(name, () => body().pipe(Effect.scoped, Effect.provide(layer), Effect.runPromise), timeout),
})
