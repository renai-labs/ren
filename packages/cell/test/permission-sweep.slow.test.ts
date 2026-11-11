import { expect, setDefaultTimeout } from "bun:test"
import { testEffect } from "@ren/executor/testing"
// ast-grep-ignore: no-import-alias -- OpenCode's Session is imported too, and both are values
import { Session as RenSession } from "@ren/schema/session"
import { Effect, Layer, Predicate, Queue, Stream } from "effect"
import { OpenCodeEvents } from "../src/harness/opencode/events.js"
import { SettingsHarness } from "./lib/settings-harness.js"
import { TestSettings } from "./lib/settings.js"
import { Shared } from "./lib/shared.js"

setDefaultTimeout(60_000)

const it = testEffect(Layer.empty)
const stub = Shared.stub()

const rules = (effect?: "ask" | "deny") =>
  TestSettings.layers({
    agents: [
      TestSettings.agent(
        "ren",
        { permissions: effect ? [{ action: "webfetch", resource: "https://example.invalid/*", effect }] : [] },
        { isSubagent: false },
      ),
      TestSettings.agent("general"),
      TestSettings.agent("explore"),
    ],
  })

const waiting = Effect.fnUntraced(function* () {
  const opened = yield* SettingsHarness.open(rules("ask"))
  const events = yield* Queue.unbounded<{ readonly type: string; readonly data: Record<string, unknown> }>()
  yield* OpenCodeEvents.stream(opened.server.fetch).pipe(
    Stream.filter(
      (event): event is { readonly type: string; readonly data: Record<string, unknown> } =>
        Predicate.isObject(event) && Predicate.isString(event.type) && Predicate.isObject(event.data),
    ),
    Stream.runForEach((event) => Queue.offer(events, event)),
    Effect.forkScoped,
  )
  const until = (type: string): Effect.Effect<Record<string, unknown>> =>
    Queue.take(events).pipe(Effect.flatMap((event) => (event.type === type ? Effect.succeed(event.data) : until(type))))
  yield* until("server.connected")
  yield* opened.harness
    .send({
      sessionId: opened.sessionId,
      messageId: RenSession.MessageID.create(),
      prompt: {
        text: `${stub.script({ tools: [{ name: "webfetch", input: { url: "https://example.invalid/a", format: "text" } }] }).marker} go`,
      },
      delivery: "steer",
      sender: { userId: "user_1" },
    })
    .pipe(Effect.orDie)
  yield* until("permission.asked")
  return { opened, until }
})

it.live("a request waits, a rule change that allows it answers it once, with no reply from a client", () =>
  Effect.gen(function* () {
    const { opened, until } = yield* waiting()
    yield* opened.pull(rules())
    expect((yield* until("permission.replied")).reply).toBe("once")
    yield* until("session.execution.succeeded")
  }),
)

it.live("a rule change that denies a waiting request rejects it", () =>
  Effect.gen(function* () {
    const { opened, until } = yield* waiting()
    yield* opened.pull(rules("deny"))
    expect((yield* until("permission.replied")).reply).toBe("reject")
  }),
)
