import { test, type TestOptions } from "bun:test"
import { Cause, Effect, Exit, Layer, type Scope } from "effect"
import { TestClock, TestConsole } from "effect/testing"
import { FetchHttpClient } from "effect/http"

type Body<A, E, R> = Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>)

const body = <A, E, R>(value: Body<A, E, R>) => Effect.suspend(() => (typeof value === "function" ? value() : value))

const loopback = new Set(["127.0.0.1", "localhost", "[::1]"])

const refuseNetwork = (violations: string[]): typeof fetch =>
  Object.assign(
    (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (loopback.has(new URL(url).hostname)) return fetch(input, init)
      const method = init?.method ?? (input instanceof Request ? input.method : "GET")
      const message = `test attempted network request: ${method} ${url} — provide an explicit HttpClient or disable the fetch`
      violations.push(message)
      return Promise.reject(new Error(message))
    },
    { preconnect: fetch.preconnect },
  )

const run = <A, E, R, E2>(name: string, value: Body<A, E, R | Scope.Scope>, layer: Layer.Layer<R, E2>) =>
  Effect.gen(function* () {
    const started = performance.now()
    let entered: number | undefined
    let finished: number | undefined
    const violations: string[] = []
    const exit = yield* Effect.suspend(() => {
      entered = performance.now()
      return body(value).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            finished = performance.now()
          }),
        ),
      )
    }).pipe(
      Effect.scoped,
      Effect.provide(layer),
      Effect.provideService(FetchHttpClient.Fetch, refuseNetwork(violations)),
      Effect.exit,
    )
    if (process.env.REN_TEST_PROFILE) {
      const ended = performance.now()
      process.stderr.write(
        `${JSON.stringify({
          harness: "effect",
          name,
          setupMs: Math.round((entered ?? ended) - started),
          bodyMs: entered === undefined ? 0 : Math.round((finished ?? ended) - entered),
          cleanupMs: finished === undefined ? 0 : Math.round(ended - finished),
          totalMs: Math.round(ended - started),
        })}\n`,
      )
    }
    if (Exit.isFailure(exit)) {
      for (const err of Cause.prettyErrors(exit.cause)) {
        yield* Effect.logError(err)
      }
    }
    if (violations.length > 0) return yield* Effect.fail(new Error(violations.join("\n")))
    return yield* exit
  }).pipe(Effect.runPromise)

const make = <R, E>(testLayer: Layer.Layer<R, E>, liveLayer: Layer.Layer<R, E>) => {
  const effect = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test(name, () => run(name, value, testLayer), opts)

  effect.only = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test.only(name, () => run(name, value, testLayer), opts)

  effect.todo = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test.todo(name, () => run(name, value, testLayer), opts)

  const live = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test(name, () => run(name, value, liveLayer), opts)

  live.only = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test.only(name, () => run(name, value, liveLayer), opts)

  live.todo = <A, E2>(name: string, value: Body<A, E2, R | Scope.Scope>, opts?: number | TestOptions) =>
    test.todo(name, () => run(name, value, liveLayer), opts)

  return { effect, live }
}

const testEnv = Layer.mergeAll(TestConsole.layer, TestClock.layer())

const liveEnv = TestConsole.layer

export const testEffect = <R, E>(layer: Layer.Layer<R, E>) =>
  make(Layer.provideMerge(layer, testEnv), Layer.provideMerge(layer, liveEnv))
