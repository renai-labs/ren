import { expect } from "bun:test"
import { Session } from "@ren/schema/session"
import { Context, DateTime, Deferred, Effect, Fiber, FiberHandle, Layer, Option, Ref, Semaphore } from "effect"
import { TestClock } from "effect/testing"
import { Cell } from "../src/cell.js"
import { Harness } from "../src/harness/harness.js"
import { Testing } from "./lib/effect.js"

const it = Testing.testEffect(Layer.empty)

const setup = Effect.gen(function* () {
  const events: Array<string> = []
  const current: {
    snapshots: Effect.Success<Harness.Instance["sessions"]>
    alarm: number | null
    reading: Effect.Effect<void>
  } = { snapshots: [], alarm: null, reading: Effect.void }
  const activity = Cell.Activity.of({
    requests: yield* Ref.make(0),
    wait: yield* FiberHandle.make<void>(),
    waitingSince: yield* Ref.make(Option.none<DateTime.Utc>()),
    configuring: yield* Semaphore.make(1),
  })
  const info = Cell.Info.of({
    sessionId: Session.ID.create(),
    vars: {
      CELL_KEYS: [{ id: "test", secret: "a-test-secret-of-at-least-32-characters" }],
      OPENCODE_CONFIG: "{}",
      ALARM_INTERVAL_MS: 30_000,
      WAIT_BUDGET_MS: 600_000,
      PARK_AFTER_MS: 600_000,
    },
    storage: {
      getAlarm: () => Promise.resolve(current.alarm),
      setAlarm: (at: number | Date) => {
        current.alarm = Number(at)
        events.push("rearm")
        return Promise.resolve()
      },
      get: () => Promise.reject(new Error("alarm must not read the model configuration")),
      put: () => Promise.reject(new Error("alarm must not write the model configuration")),
      delete: () => Promise.reject(new Error("alarm must not remove the model configuration")),
    },
  })
  const instance: Harness.Instance = {
    fetch: () => Promise.resolve(new Response(null)),
    configure: () => Effect.die(new Error("alarm must not configure models")),
    start: () => Effect.die(new Error("alarm must not start sessions")),
    send: () => Effect.die(new Error("alarm must not send messages")),
    sessions: Effect.suspend(() => current.reading.pipe(Effect.andThen(Effect.sync(() => current.snapshots)))),
  }
  const context = yield* Layer.build(
    Harness.layer(
      Effect.acquireRelease(
        Effect.sync(() => {
          events.push("open")
          return instance
        }),
        () =>
          Effect.sync(() => {
            events.push("close")
          }),
      ),
    ),
  )
  const harness = Context.get(context, Harness.Service)
  yield* Effect.addFinalizer(() => harness.close)
  return {
    events,
    current,
    activity,
    harness,
    run: <A, E, R>(effect: Effect.Effect<A, E, R | Cell.Info | Cell.Activity | Harness.Service>) =>
      effect.pipe(
        Effect.provideService(Cell.Info, info),
        Effect.provideService(Cell.Activity, activity),
        Effect.provideService(Harness.Service, harness),
      ),
    session: (fields: Partial<Effect.Success<Harness.Instance["sessions"]>[number]> = {}) => ({
      id: "root",
      active: false,
      inbox: [],
      unfinished: false,
      questionAgeMs: undefined,
      resend: (id: string) =>
        Effect.sync(() => {
          events.push(`resend:${id}`)
        }),
      interrupt: Effect.sync(() => {
        events.push("interrupt")
      }),
      wait: (ms: number) =>
        Effect.sync(() => {
          events.push(`wait:${ms}`)
        }).pipe(Effect.andThen(Effect.sleep(ms))),
      ...fields,
    }),
  }
})

it.effect("idle reconciliation releases its lease and closes the host without rearming", () =>
  Effect.gen(function* () {
    const cell = yield* setup
    cell.current.snapshots = [cell.session()]
    yield* cell.run(Cell.alarm())
    expect(cell.events).toEqual(["open", "close"])
    expect(yield* cell.harness.state).toEqual({ isOpen: false, holders: 0 })
  }),
)

it.effect("running work rearms before waiting, uses the budget, and starts no duplicate wait", () =>
  Effect.gen(function* () {
    const cell = yield* setup
    cell.current.snapshots = [cell.session(), cell.session({ id: "child", active: true })]
    const alarm = yield* Effect.forkChild(cell.run(Cell.alarm()))
    yield* TestClock.adjust("30 seconds")
    expect(cell.events).toEqual(["open", "rearm", "wait:600000"])
    expect(yield* Ref.get(cell.activity.waitingSince)).toEqual(Option.some(DateTime.makeUnsafe(0)))
    yield* cell.run(Cell.alarm())
    expect(cell.events.filter((event) => event.startsWith("wait:"))).toHaveLength(1)
    yield* TestClock.adjust("570 seconds")
    yield* Fiber.join(alarm)
    expect(cell.events).not.toContain("close")
    expect(cell.current.alarm).toBe(630_000)
    expect(yield* Ref.get(cell.activity.waitingSince)).toEqual(Option.none())
  }),
)

it.effect("a question's remaining park time bounds the wait", () =>
  Effect.gen(function* () {
    const cell = yield* setup
    cell.current.snapshots = [cell.session({ active: true, questionAgeMs: 590_000 })]
    const alarm = yield* Effect.forkChild(cell.run(Cell.alarm()))
    yield* TestClock.adjust("10 seconds")
    yield* Fiber.join(alarm)
    expect(cell.events).toEqual(["open", "rearm", "wait:10000", "rearm"])
  }),
)

it.effect("unanswered questions are interrupted and queued prompts resent before rearming", () =>
  Effect.gen(function* () {
    const cell = yield* setup
    cell.current.snapshots = [
      cell.session({ active: true, questionAgeMs: 600_000 }),
      cell.session({
        id: "queued",
        inbox: [
          { id: "first", type: "user" },
          { id: "second", type: "user" },
        ],
      }),
    ]
    yield* cell.run(Cell.alarm())
    expect(cell.events).toEqual(["open", "interrupt", "resend:first", "rearm"])
    cell.current.snapshots = [cell.session()]
    yield* cell.run(Cell.alarm())
    expect(cell.events.at(-1)).toBe("close")
  }),
)

it.effect("unfinished work keeps the host open without resending it", () =>
  Effect.gen(function* () {
    const cell = yield* setup
    cell.current.snapshots = [cell.session({ unfinished: true })]
    yield* cell.run(Cell.alarm())
    expect(cell.events).toEqual(["open", "rearm"])
  }),
)

it.effect("an outstanding request lease prevents an idle close", () =>
  Effect.gen(function* () {
    const cell = yield* setup
    yield* cell.run(Cell.acquire)
    yield* cell.run(Cell.alarm())
    expect(cell.events).toEqual(["rearm", "open", "rearm"])
    expect((yield* cell.harness.state).holders).toBe(1)
  }),
)

it.effect("a request that finishes during reconciliation still prevents closing that generation", () =>
  Effect.gen(function* () {
    const cell = yield* setup
    const entered = yield* Deferred.make<void>()
    const released = yield* Deferred.make<void>()
    cell.current.snapshots = [cell.session()]
    cell.current.reading = Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(released)))
    const alarm = yield* Effect.forkChild(cell.run(Cell.alarm()))
    yield* Deferred.await(entered)
    yield* Effect.scoped(cell.run(Cell.acquire))
    yield* Deferred.succeed(released, undefined)
    yield* Fiber.join(alarm)
    expect(cell.events).not.toContain("close")
    expect(yield* Ref.get(cell.activity.requests)).toBe(1)
  }),
)

it.effect("interrupting an alarm clears its wait and releases its lease, retaining the durable alarm", () =>
  Effect.gen(function* () {
    const cell = yield* setup
    cell.current.snapshots = [cell.session({ active: true })]
    const alarm = yield* Effect.forkChild(cell.run(Cell.alarm()))
    yield* TestClock.adjust("1 second")
    yield* Fiber.interrupt(alarm)
    expect(yield* Ref.get(cell.activity.waitingSince)).toEqual(Option.none())
    expect((yield* cell.harness.state).holders).toBe(0)
    expect(cell.current.alarm).toBe(30_000)
  }),
)
