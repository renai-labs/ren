import { expect, test } from "bun:test"
import { Agent } from "@opencode/client/effect"
import { SessionID } from "@opencode/schema/session-id"
import { testEffect } from "@ren/executor/testing"
import { Session } from "@ren/schema/session"
import {
  Context,
  DateTime,
  Deferred,
  Effect,
  Fiber,
  FiberHandle,
  Layer,
  Option,
  Queue,
  Ref,
  Semaphore,
  Stream,
} from "effect"
import { TestClock } from "effect/testing"
import { OpenCodeSync } from "@ren/brain/opencode-sync"
import { Cell } from "../src/cell.js"
import { Harness } from "../src/harness/harness.js"
import { OpenCodeChat } from "../src/harness/opencode/chat.js"
import { Sync } from "../src/sync.js"
import { BrainTest } from "./lib/brain.js"
import { Shared } from "./lib/shared.js"

const it = testEffect(Layer.empty)

const setup = Effect.gen(function* () {
  const events: Array<string> = []
  const current: {
    snapshots: Effect.Success<Harness.Instance["sessions"]>
    alarm: number | null
    reading: Effect.Effect<void>
    closing: Effect.Effect<void>
    steps: Array<Effect.Effect<OpenCodeSync.Step, OpenCodeSync.SyncError>>
  } = { snapshots: [], alarm: null, reading: Effect.void, closing: Effect.void, steps: [] }
  const activity = Cell.Activity.of({
    requests: yield* Ref.make(0),
    wait: yield* FiberHandle.make<void>(),
    waitingSince: yield* Ref.make(Option.none<DateTime.Utc>()),
    configuring: yield* Semaphore.make(1),
    closedIdle: yield* Ref.make(false),
  })
  const sync = yield* Sync.make(
    Option.some({
      step: () => Effect.suspend(() => current.steps.shift() ?? Effect.succeed({ drained: true })),
      exclusive: (effect) => effect,
      restore: () => Effect.void,
    }),
  )
  const info = Cell.Info.of({
    sessionId: Session.ID.create(),
    vars: {
      CELL_KEYS: [{ id: "test", secret: "a-test-secret-of-at-least-32-characters" }],
      OPENCODE_CONFIG: "{}",
      ALARM_INTERVAL_MS: 30_000,
      WAIT_BUDGET_MS: 600_000,
      PARK_AFTER_MS: 600_000,
      CHAT_IDLE_MS: 120_000,
      CHAT_HEARTBEAT_MS: 15_000,
    },
    storage: {
      getAlarm: () => Promise.resolve(current.alarm),
      setAlarm: (at: number | Date) => {
        current.alarm = Number(at)
        events.push("rearm")
        return Promise.resolve()
      },
    },
  })
  const fetch = () => Promise.resolve(new Response(null))
  const instance: Harness.Instance = {
    fetch,
    chat: OpenCodeChat.make(fetch),
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
          Effect.suspend(() => current.closing).pipe(
            Effect.andThen(
              Effect.sync(() => {
                events.push("close")
              }),
            ),
          ),
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
    run: <A, E, R>(effect: Effect.Effect<A, E, R | Cell.Info | Cell.Activity | Harness.Service | Sync.Service>) =>
      effect.pipe(
        Effect.provideService(Cell.Info, info),
        Effect.provideService(Cell.Activity, activity),
        Effect.provideService(Harness.Service, harness),
        Effect.provideService(Sync.Service, sync),
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
    expect(cell.current.alarm).toBeNull()
  }),
)

it.effect("running work rearms before waiting, waits exactly the budget, and starts no duplicate wait", () =>
  Effect.gen(function* () {
    const cell = yield* setup
    cell.current.snapshots = [cell.session(), cell.session({ id: "child", active: true })]
    const alarm = yield* Effect.forkChild(cell.run(Cell.alarm()))
    yield* TestClock.adjust("30 seconds")
    expect(cell.events).toEqual(["open", "rearm", "wait:600000"])
    expect(yield* Ref.get(cell.activity.waitingSince)).toEqual(Option.some(DateTime.makeUnsafe(0)))
    yield* cell.run(Cell.alarm())
    expect(cell.events.filter((event) => event.startsWith("wait:"))).toHaveLength(1)
    yield* TestClock.adjust(569_999)
    expect(alarm.pollUnsafe()).toBeUndefined()
    yield* TestClock.adjust(1)
    yield* Fiber.join(alarm)
    expect(cell.events).not.toContain("close")
    expect(cell.current.alarm).toBe(630_000)
    expect(yield* Ref.get(cell.activity.waitingSince)).toEqual(Option.none())
    expect((yield* cell.harness.state).holders).toBe(0)
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

it.effect(
  "interrupting an alarm clears its wait and releases its lease, retaining the durable alarm, and the next alarm reconciles",
  () =>
    Effect.gen(function* () {
      const cell = yield* setup
      cell.current.snapshots = [cell.session({ active: true })]
      const alarm = yield* Effect.forkChild(cell.run(Cell.alarm()))
      yield* TestClock.adjust("1 second")
      yield* Fiber.interrupt(alarm)
      expect(yield* Ref.get(cell.activity.waitingSince)).toEqual(Option.none())
      expect((yield* cell.harness.state).holders).toBe(0)
      expect(cell.current.alarm).toBe(30_000)
      cell.current.snapshots = [cell.session()]
      yield* cell.run(Cell.alarm())
      expect(cell.events.at(-1)).toBe("close")
      expect(yield* cell.harness.state).toEqual({ isOpen: false, holders: 0 })
    }),
)

it.effect("a request that arrives while the host closes waits for the close, then opens a new host", () =>
  Effect.gen(function* () {
    const cell = yield* setup
    const entered = yield* Deferred.make<void>()
    const released = yield* Deferred.make<void>()
    cell.current.snapshots = [cell.session()]
    cell.current.closing = Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(released)))
    const alarm = yield* Effect.forkChild(cell.run(Cell.alarm()))
    yield* Deferred.await(entered)
    const request = yield* Effect.forkChild(Effect.scoped(cell.run(Cell.acquire)))
    yield* TestClock.adjust("1 second")
    expect(cell.events.filter((event) => event === "open")).toHaveLength(1)
    expect(request.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(released, undefined)
    yield* Fiber.join(alarm)
    yield* Fiber.join(request)
    expect(cell.events.filter((event) => event === "open" || event === "close")).toEqual(["open", "close", "open"])
  }),
)

test.todo("REN-1486 two alarms that reconcile at once resend a queued prompt once and open one host", () =>
  Effect.gen(function* () {
    const cell = yield* setup
    const entered = yield* Queue.unbounded<void>()
    const released = yield* Deferred.make<void>()
    cell.current.snapshots = [cell.session({ inbox: [{ id: "first", type: "user" }] })]
    cell.current.reading = Queue.offer(entered, undefined).pipe(Effect.andThen(Deferred.await(released)))
    const alarms = yield* Effect.forkChild(
      Effect.all([cell.run(Cell.alarm()), cell.run(Cell.alarm())], { concurrency: "unbounded" }),
    )
    yield* Queue.take(entered)
    yield* Queue.take(entered)
    yield* Deferred.succeed(released, undefined)
    yield* Fiber.join(alarms)
    expect(cell.events.filter((event) => event === "open")).toHaveLength(1)
    expect(cell.events.filter((event) => event.startsWith("resend:"))).toEqual(["resend:first"])
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer()), Effect.runPromise),
)

const opencode = testEffect(BrainTest.layer)

const question = {
  name: "question",
  input: { questions: [{ question: "Which one?", header: "Pick", options: [{ label: "A", description: "a" }] }] },
}

const closed = { isOpen: false, holders: 0, waitingSince: null, nextReconcileAt: null }

opencode.effect("a running child session keeps the harness open while the root session is idle", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    yield* brain.start()
    const child = yield* brain.opencode.session.create({
      id: SessionID.make(`${brain.id}_child`),
      parentID: SessionID.make(brain.id),
    })
    const script = Shared.stub().script({ hold: true })
    yield* brain.opencode.session.prompt({ sessionID: child.id, text: `child ${script.marker}` })
    yield* Effect.promise(() => script.called())
    const alarm = yield* Effect.forkChild(brain.alarm)
    expect(yield* brain.waited).toBe(3000)
    expect(yield* brain.state).toMatchObject({ isOpen: true, waitingSince: DateTime.makeUnsafe(0) })
    expect(Object.keys(yield* brain.opencode.session.active())).toEqual([child.id])
    script.release()
    yield* Fiber.join(alarm)
    expect(yield* brain.state).toMatchObject({ isOpen: true, waitingSince: null })
    yield* brain.alarm
    expect(yield* brain.state).toEqual(closed)
  }),
)

opencode.effect("a question unanswered for the park time is interrupted, and then the harness closes", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    yield* brain.start()
    const connected = yield* Deferred.make<void>()
    const asked = yield* brain.opencode.event.subscribe().pipe(
      Stream.tap((event) => (event.type === "server.connected" ? Deferred.succeed(connected, undefined) : Effect.void)),
      Stream.filter((event) => event.type === "form.created"),
      Stream.runHead,
      Effect.forkChild,
    )
    yield* Deferred.await(connected)
    const script = Shared.stub().script({ tool: question })
    yield* brain.send(`ask ${script.marker}`)
    yield* Fiber.join(asked)
    const waiting = yield* Effect.forkChild(brain.alarm)
    expect(yield* brain.waited).toBe(2000)
    yield* TestClock.adjust(2000)
    yield* Fiber.join(waiting)
    yield* brain.alarm
    const sessionID = SessionID.make(brain.id)
    yield* brain.opencode.session.wait({ sessionID })
    yield* brain.alarm
    expect(yield* brain.state).toEqual(closed)
    expect(
      (yield* brain.opencode.message.list({ sessionID, order: "asc" })).data.map((message) =>
        message.type === "idle" ? `idle:${message.outcome}` : message.type,
      ),
    ).toEqual(["user", "assistant", "idle:interrupted"])
    expect(script.calls).toHaveLength(1)
  }),
)

opencode.effect("a prompt queued behind a running turn runs after it, and the harness closes after both", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.Service
    yield* brain.start()
    const first = Shared.stub().script({ hold: true, reply: "first answer" })
    const second = Shared.stub().script({ reply: "second answer" })
    yield* brain.send(`first ${first.marker}`)
    yield* Effect.promise(() => first.called())
    yield* brain.send(`second ${second.marker}`, { delivery: "queue" })
    const alarm = yield* Effect.forkChild(brain.alarm)
    yield* brain.waited
    first.release()
    yield* Fiber.join(alarm)
    expect((yield* brain.state).isOpen).toBe(true)
    yield* Effect.promise(() => second.called())
    const sessionID = SessionID.make(brain.id)
    yield* brain.opencode.session.wait({ sessionID })
    yield* brain.alarm
    expect(yield* brain.state).toEqual(closed)
    expect(
      (yield* brain.opencode.message.list({ sessionID, order: "asc" })).data.flatMap((message) =>
        message.type === "assistant"
          ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
          : [],
      ),
    ).toEqual(["first answer", "second answer"])
    expect(second.calls).toHaveLength(1)
  }),
)

opencode.effect(
  "a finished turn more than a page of messages back still reads as finished, and the harness closes",
  () =>
    Effect.gen(function* () {
      const brain = yield* BrainTest.Service
      yield* brain.start()
      const sessionID = SessionID.make(brain.id)
      yield* brain.send(`once ${Shared.stub().script().marker}`)
      yield* brain.opencode.session.wait({ sessionID })
      yield* Effect.forEach(
        Array.from({ length: 60 }),
        () => brain.opencode.session.switchAgent({ sessionID, agent: Agent.ID.make("build") }),
        { discard: true },
      )
      const page = yield* brain.opencode.message.list({ sessionID, order: "desc", limit: 50 })
      expect(page.data.every((message) => message.type === "agent-switched")).toBe(true)
      yield* brain.alarm
      expect(yield* brain.state).toEqual(closed)
    }),
)

const unavailable = new OpenCodeSync.SyncError({ reason: "unavailable", message: "Ren is down" })

test.each<[string, boolean, OpenCodeSync.Step, number | null]>([
  ["an idle host after a step that is not drained", false, { drained: false }, 250],
  ["an idle host after the O4 limit held a busy session", false, { drained: false, throttledUntil: 120_000 }, 120_000],
  ["an idle host after a drained step", false, { drained: true }, null],
  ["unfinished work after a step that is not drained", true, { drained: false }, 250],
  ["unfinished work after the O4 limit held a busy session", true, { drained: false, throttledUntil: 120_000 }, 30_000],
])(
  "a sync step that is not drained sets the next alarm at 250 ms, or at the O4 limit of the first busy session: %s",
  (_name, unfinished, step, alarm) =>
    Effect.gen(function* () {
      const cell = yield* setup
      cell.current.snapshots = [cell.session({ unfinished })]
      cell.current.steps = [Effect.succeed(step)]
      yield* cell.run(Cell.alarm())
      expect(cell.current.alarm).toBe(alarm)
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer()), Effect.runPromise),
)

it.effect("the alarm stays set while sync is not drained, also after reconcile closed OpenCode", () =>
  Effect.gen(function* () {
    const cell = yield* setup
    cell.current.snapshots = [cell.session()]
    cell.current.steps = [
      Effect.succeed({ drained: false }),
      Effect.fail(unavailable),
      Effect.succeed({ drained: true }),
    ]
    const fire = Effect.sync(() => {
      cell.current.alarm = null
    }).pipe(Effect.andThen(cell.run(Cell.alarm())), Effect.andThen(Effect.sync(() => cell.current.alarm)))
    expect(yield* fire).toBe(250)
    expect(cell.events).toEqual(["open", "close", "rearm"])
    expect(yield* fire).toBeGreaterThanOrEqual(1000)
    expect(yield* fire).toBeNull()
    expect(cell.events).toEqual(["open", "close", "rearm", "rearm"])
    expect(yield* cell.harness.state).toEqual({ isOpen: false, holders: 0 })
  }),
)
