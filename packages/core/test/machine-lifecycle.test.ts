import { describe, expect } from "bun:test"
import { Auth } from "@ren/schema/auth"
import { Space } from "@ren/schema/space"
import { Clock, Duration, Effect, ErrorReporter, Fiber, Option, Schema } from "effect"
import { TestClock } from "effect/testing"
import { EnvironmentProvider } from "../src/environment-provider.js"
import { MachineLifecycle } from "../src/machine-lifecycle.js"
import { MachineProvider } from "../src/machine-provider.js"
import { testEffect } from "./lib/effect.js"

const reports: Array<string> = []

const it = testEffect(
  ErrorReporter.layer([
    ErrorReporter.make((report) =>
      reports.push(
        `${"_tag" in report.error ? String(report.error._tag) : report.error.name}: ${report.error.message}`,
      ),
    ),
  ]),
)

const capacityFor = Duration.seconds(30)

// oxlint-disable-next-line ren/no-comments -- A kind of machine that lives in memory: its rows in a map, its provider a counter, its ready check and its probe two switches.
const kind = Effect.gen(function* () {
  const rows = new Map<string, MachineLifecycle.Row<string>>()
  const switches = { boots: false, answers: true, capacity: false }
  const destroyed: Array<number> = []
  const made = { count: 0 }
  const provider = MachineProvider.make({
    id: EnvironmentProvider.ID.make("memory"),
    title: "Memory",
    description: "Machines in the test’s memory.",
    canEgress: false,
    canMount: false,
    canSample: false,
    config: Schema.Struct({}),
    binding: Schema.Struct({ number: Schema.Int }),
    create: () => {
      if (switches.capacity) {
        switches.capacity = false
        return Effect.fail(new MachineProvider.Capacity({ message: "no room", retryAfter: capacityFor }))
      }
      made.count += 1
      return Effect.succeed({ binding: { number: made.count }, url: `http://machine-${made.count}.test` })
    },
    connect: (binding) => Effect.succeed({ url: `http://machine-${binding.number}.test` }),
    destroy: (binding) => Effect.sync(() => destroyed.push(binding.number)),
    status: () => Effect.succeed("running" as const),
  })
  const read = (id: string) => Effect.sync(() => rows.get(id)).pipe(Effect.flatMap(Effect.fromNullishOr), Effect.orDie)
  const update = (id: string, values: Partial<MachineLifecycle.Row<string>>) =>
    Effect.flatMap(read(id), (row) => Effect.sync(() => void rows.set(id, { ...row, ...values })))
  const holder: { run?: (id: string) => Effect.Effect<void, unknown> } = {}
  const machines = MachineLifecycle.make({
    name: "TestLifecycle",
    noun: "Machine",
    annotation: "machine",
    provider,
    isBehindEgress: false,
    bootWithin: Duration.seconds(1),
    wakeWithin: Duration.seconds(1),
    read,
    update,
    replace: (row) =>
      update(row.id, {
        generation: row.generation + 1,
        binding: null,
        url: null,
        keep_alive_until: null,
        phase: "creating",
      }),
    lose: (id, generation) =>
      Effect.flatMap(read(id), (row) =>
        row.generation === generation && row.phase !== "creating" && row.phase !== "replacing"
          ? update(id, { phase: "replacing" }).pipe(Effect.as(true))
          : Effect.succeed(false),
      ),
    isNeeded: () => Effect.succeed(true),
    ensure: (row) => (holder.run ? holder.run(row.id).pipe(Effect.ignore) : Effect.void),
    proxyFor: () => Effect.succeedNone,
    retire: () => Effect.void,
    variables: () => Effect.succeed({}),
    created: () => Effect.void,
    target: (row) => Option.fromNullishOr(row.url),
    boot: () => Effect.sync(() => (switches.boots ? Option.none() : Option.some("The machine did not answer"))),
    wake: () => Effect.succeed(true),
    answers: () => Effect.sync(() => switches.answers),
  })
  holder.run = machines.run
  const add = (values: Partial<MachineLifecycle.Row<string>> = {}) => {
    const id = `machine-${rows.size + 1}`
    rows.set(id, {
      id,
      organization_id: Auth.OrganizationID.create(),
      space_id: Space.ID.create(),
      provider: null,
      binding: null,
      template: null,
      egress: false,
      url: null,
      generation: 1,
      run_epoch: 0,
      phase: "creating",
      failures: 0,
      failure: null,
      keep_alive_until: null,
      last_active_at: null,
      last_progress_at: null,
      retry_at: null,
      retries: 0,
      unanswered_since: null,
      ...values,
    })
    return id
  }
  return { machines, switches, destroyed, read, update, add }
})

describe("MachineLifecycle", () => {
  it.effect(
    "a machine that fails 3 times waits 10 min, then 30 min, then every hour; the next access after that starts it again (EN19, chaos row 1)",
    () =>
      Effect.gen(function* () {
        reports.length = 0
        const memory = yield* kind
        const id = memory.add()
        const phase = Effect.map(memory.machines.access(id), (access) => access._tag)
        expect(yield* phase).toBe("Starting")
        expect(yield* memory.read(id)).toMatchObject({ phase: "failed", failures: 3, retries: 0 })
        const waits = [Duration.minutes(10), Duration.minutes(30), Duration.hours(1), Duration.hours(1)]
        yield* Effect.forEach(
          waits,
          (wait, index) =>
            Effect.gen(function* () {
              yield* TestClock.adjust(Duration.subtract(wait, Duration.seconds(1)))
              expect(yield* phase).toBe("Failed")
              yield* TestClock.adjust(Duration.seconds(1))
              if (index === waits.length - 1) memory.switches.boots = true
              expect(yield* phase).toBe("Starting")
            }),
          { discard: true },
        )
        expect(yield* memory.read(id)).toMatchObject({ phase: "ready", failures: 0, retries: 0, retry_at: null })
        expect(reports.filter((report) => report.includes("MachineLifecycle.Failed"))).toHaveLength(4)
      }),
  )

  it.effect("the Retry button starts a failed machine at once, and the timed retries count from 10 min again", () =>
    Effect.gen(function* () {
      const memory = yield* kind
      const id = memory.add()
      yield* memory.machines.access(id)
      yield* TestClock.adjust(Duration.minutes(10))
      yield* memory.machines.access(id)
      expect(yield* memory.read(id)).toMatchObject({ phase: "failed", retries: 1 })
      yield* memory.machines.retry(id)
      expect(yield* memory.read(id)).toMatchObject({ phase: "failed", retries: 0 })
      yield* TestClock.adjust(Duration.minutes(10))
      expect((yield* memory.machines.access(id))._tag).toBe("Starting")
    }),
  )

  it.effect(
    "a machine whose brain gives no answer for 5 min while it runs is replaced; an answer in between starts the count again (EN17)",
    () =>
      Effect.gen(function* () {
        reports.length = 0
        const memory = yield* kind
        memory.switches.boots = true
        const id = memory.add()
        yield* memory.machines.access(id)
        expect(yield* memory.read(id)).toMatchObject({ phase: "ready", generation: 1 })
        memory.switches.answers = false
        yield* memory.machines.check(id)
        yield* TestClock.adjust(Duration.minutes(4))
        yield* memory.machines.check(id)
        memory.switches.answers = true
        yield* memory.machines.check(id)
        memory.switches.answers = false
        yield* TestClock.adjust(Duration.minutes(1))
        yield* memory.machines.check(id)
        expect(yield* memory.read(id)).toMatchObject({ phase: "ready", generation: 1 })
        yield* TestClock.adjust(Duration.minutes(5))
        yield* memory.machines.check(id)
        expect(yield* memory.read(id)).toMatchObject({ phase: "ready", generation: 2 })
        expect(reports.filter((report) => report.includes("MachineLifecycle.Replaced"))).toHaveLength(1)
      }),
  )

  it.effect("waiting for capacity is reported once, with the provider's reason (EN38)", () =>
    Effect.gen(function* () {
      reports.length = 0
      const memory = yield* kind
      memory.switches.boots = true
      memory.switches.capacity = true
      const id = memory.add()
      const access = yield* memory.machines.access(id).pipe(Effect.forkChild)
      yield* TestClock.adjust(capacityFor)
      yield* Fiber.join(access)
      expect(yield* memory.read(id)).toMatchObject({ phase: "ready", failures: 0 })
      expect(reports.filter((report) => report.includes("no room"))).toHaveLength(1)
    }),
  )
})

describe("MachineLifecycle keep-awake", () => {
  it.effect(
    "a background process keeps an idle machine awake up to 2 h after the last turn's progress, and no longer (EN25)",
    () =>
      Effect.gen(function* () {
        const memory = yield* kind
        memory.switches.boots = true
        const id = memory.add()
        yield* memory.machines.access(id)
        const lastTurn = new Date(yield* Clock.currentTimeMillis)
        yield* memory.update(id, { last_progress_at: lastTurn })
        const awakeUntil = Effect.map(memory.read(id), (row) => row.keep_alive_until?.getTime() ?? 0)
        const keep = Effect.flatMap(memory.read(id), (row) =>
          memory.machines.keepAwake(row, { isBusy: false, hasBackground: true }),
        )
        yield* TestClock.adjust(Duration.minutes(60))
        yield* keep
        expect(yield* awakeUntil).toBe(lastTurn.getTime() + Duration.toMillis(Duration.minutes(90)))
        yield* TestClock.adjust(Duration.minutes(55))
        yield* keep
        expect(yield* awakeUntil).toBe(lastTurn.getTime() + Duration.toMillis(Duration.hours(2)))
        yield* TestClock.adjust(Duration.minutes(10))
        yield* keep
        expect(yield* awakeUntil).toBe(lastTurn.getTime() + Duration.toMillis(Duration.hours(2)))
      }),
  )
})
