import { expect } from "bun:test"
import { testEffect } from "@ren/executor/testing"
import { Duration, Effect, Layer, Queue, Ref, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Shell } from "@opencode/schema/shell"
import { Watchdog } from "../src/harness/opencode/watchdog.js"

const it = testEffect(Layer.empty)

interface Call {
  readonly kind: "background" | "notify"
  readonly sessionID: string
  readonly text?: string
  readonly description?: string
}

const harness = Effect.fnUntraced(function* (settings?: Partial<Watchdog.Settings>) {
  const events = yield* Queue.unbounded<{ readonly type: string; readonly data: unknown }>()
  const shells = yield* Ref.make<ReadonlyMap<string, ReadonlyArray<Watchdog.Shell>>>(new Map())
  const calls = yield* Ref.make<ReadonlyArray<Call>>([])
  const record = (call: Call) => Ref.update(calls, (all) => [...all, call])
  yield* Watchdog.run({
    events: Stream.fromQueue(events),
    shells: (sessionID) => Effect.map(Ref.get(shells), (all) => all.get(sessionID) ?? []),
    background: (sessionID) => record({ kind: "background", sessionID }),
    notify: (input) => record({ kind: "notify", ...input }),
    ...(settings && { settings }),
  })
  const emit = (type: string, sessionID: string) =>
    Queue.offer(events, { type, data: { sessionID } }).pipe(Effect.andThen(TestClock.adjust(0)))
  const running = (sessionID: string, list: ReadonlyArray<Watchdog.Shell>) =>
    Ref.update(shells, (all) => new Map([...all, [sessionID, list]]))
  return { emit, running, calls: Ref.get(calls) }
})

const check = { id: Shell.ID.ascending(), pid: 10, command: "bun run check" }

it.effect(
  "a session with no step for the stall time has its blocking work backgrounded once, and the chat sees which command",
  () =>
    Effect.gen(function* () {
      const test = yield* harness()
      yield* test.running("S", [check])
      yield* test.emit("session.execution.started", "S")
      yield* test.emit("session.step.started", "S")
      yield* TestClock.adjust(Duration.subtract(Watchdog.defaults.stallAfter, Duration.seconds(1)))
      expect(yield* test.calls).toEqual([])
      yield* TestClock.adjust("1 second")
      expect(yield* test.calls).toEqual([
        { kind: "background", sessionID: "S" },
        {
          kind: "notify",
          sessionID: "S",
          text: expect.stringContaining("after 5 minutes without progress"),
          description: "Still running `bun run check` (5 min). Moved to the background.",
        },
      ])
      yield* TestClock.adjust(Watchdog.defaults.stallAfter)
      expect((yield* test.calls).length).toBe(2)
      yield* test.emit("session.step.ended", "S")
      yield* TestClock.adjust(Watchdog.defaults.stallAfter)
      expect((yield* test.calls).length).toBe(4)
    }),
)

it.effect("a step restarts the stall timer, and the end of the turn stops it", () =>
  Effect.gen(function* () {
    const test = yield* harness()
    yield* test.running("S", [check])
    yield* test.running("T", [check])
    yield* test.emit("session.execution.started", "S")
    yield* test.emit("session.execution.started", "T")
    yield* TestClock.adjust("3 minutes")
    yield* test.emit("session.step.ended", "S")
    yield* test.emit("session.execution.succeeded", "T")
    yield* TestClock.adjust("3 minutes")
    expect(yield* test.calls).toEqual([])
    yield* TestClock.adjust("2 minutes")
    expect((yield* test.calls).map((call) => [call.kind, call.sessionID])).toEqual([
      ["background", "S"],
      ["notify", "S"],
    ])
  }),
)

it.effect("a stall with no running command does nothing", () =>
  Effect.gen(function* () {
    const test = yield* harness()
    yield* test.emit("session.execution.started", "S")
    yield* TestClock.adjust(Watchdog.defaults.stallAfter)
    expect(yield* test.calls).toEqual([])
  }),
)
