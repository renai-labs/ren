import { expect, test } from "bun:test"
import type { Session } from "@ren/schema/session"
import { DateTime, Effect, Fiber, Layer, type Scope, SubscriptionRef } from "effect"
import { FetchHttpClient, type HttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { ChatAccess } from "../src/chat-access.js"
import { ChatTest } from "./lib/chat.js"

const requests: Array<string> = []

const brain = FetchHttpClient.layer.pipe(
  Layer.provide(
    Layer.succeed(
      FetchHttpClient.Fetch,
      Object.assign(
        (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init)
          requests.push(`${new URL(request.url).origin} ${request.headers.get("authorization")}`)
          return Promise.resolve(Response.json([]))
        },
        { preconnect: fetch.preconnect },
      ),
    ),
  ),
)

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope | HttpClient.HttpClient>) => {
  requests.length = 0
  return body.pipe(Effect.scoped, Effect.provide(brain), Effect.provide(TestClock.layer()), Effect.runPromise)
}

const ready = (url: string, token: string, expiresAt: number): Session.ClientAccess => ({
  status: "ready",
  url,
  token,
  expiresAt: DateTime.makeUnsafe(expiresAt),
})

const answering = (answers: Array<Session.ClientAccess>) => {
  const asked: Array<boolean> = []
  return {
    asked,
    access: (input: { readonly unreachable: boolean }) =>
      Effect.sync(() => {
        asked.push(input.unreachable)
        return answers.shift() ?? { status: "failed" as const, reason: "no answer left" }
      }),
  }
}

test("while the brain starts, Ren is asked again every 2 seconds until the brain is ready", () =>
  run(
    Effect.gen(function* () {
      const ren = answering([
        { status: "starting", phase: "waking" },
        { status: "starting", phase: "restoring" },
        ready("http://one", "one", 3_600_000),
      ])
      const access = yield* ChatAccess.make({ access: ren.access })
      expect(yield* SubscriptionRef.get(access.boot)).toEqual({ _tag: "Checking" })
      const client = yield* access.client.pipe(Effect.forkChild)
      expect(yield* ChatTest.until(access.boot, (boot) => boot._tag === "Starting")).toEqual({
        _tag: "Starting",
        phase: "waking",
      })
      yield* TestClock.adjust("1999 millis")
      expect(ren.asked).toHaveLength(1)
      yield* TestClock.adjust("1 millis")
      expect(yield* SubscriptionRef.get(access.boot)).toEqual({ _tag: "Starting", phase: "restoring" })
      yield* TestClock.adjust("2 seconds")
      yield* Fiber.join(client)
      expect(yield* SubscriptionRef.get(access.boot)).toEqual({ _tag: "Ready" })
      expect(ren.asked).toEqual([false, false, false])
    }),
  ))

test.each([
  ["failed", { status: "failed", reason: "no capacity" }, { _tag: "Failed", reason: "no capacity" }],
  ["stopped", { status: "stopped" }, { _tag: "Stopped" }],
] as const)("a %s brain fails access and stays so without asking Ren again", (_name, answer, boot) =>
  run(
    Effect.gen(function* () {
      const ren = answering([answer, ready("http://one", "one", 3_600_000)])
      const access = yield* ChatAccess.make({ access: ren.access })
      expect((yield* Effect.flip(access.client))._tag).toBe("ChatAccess.AccessFailed")
      expect((yield* Effect.flip(access.client))._tag).toBe("ChatAccess.AccessFailed")
      expect(yield* SubscriptionRef.get(access.boot)).toEqual(boot)
      expect(ren.asked).toHaveLength(1)
    }),
  ),
)

test("within a minute of expiresAt the next request asks Ren again first and goes to the new URL with the new token", () =>
  run(
    Effect.gen(function* () {
      const ren = answering([ready("http://one", "one", 120_000), ready("http://two", "two", 3_600_000)])
      const access = yield* ChatAccess.make({ access: ren.access })
      yield* Effect.flatMap(access.client, (api) => api.model.list())
      yield* TestClock.adjust("59 seconds")
      yield* Effect.flatMap(access.client, (api) => api.model.list())
      expect(ren.asked).toHaveLength(1)
      yield* TestClock.adjust("2 seconds")
      yield* Effect.flatMap(access.client, (api) => api.model.list())
      expect(ren.asked).toHaveLength(2)
      expect(requests).toEqual([
        `http://one Basic ${btoa("ren:one")}`,
        `http://one Basic ${btoa("ren:one")}`,
        `http://two Basic ${btoa("ren:two")}`,
      ])
    }),
  ))
