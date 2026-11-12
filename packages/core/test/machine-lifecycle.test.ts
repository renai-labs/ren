import { describe, expect } from "bun:test"
import { ExecutorVariables } from "@ren/hand-api/executor-variables"
import { Auth } from "@ren/schema/auth"
import { Hand } from "@ren/schema/hand"
import { MachineTemplate } from "@ren/schema/machine-template"
import { Space } from "@ren/schema/space"
import { Clock, DateTime, Deferred, Duration, Effect, ErrorReporter, Fiber, Option, Schema } from "effect"
import { TestClock } from "effect/testing"
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

const templateId = MachineTemplate.ID.create()

// oxlint-disable-next-line ren/no-comments -- A kind of machine that lives in memory: its rows in a map, its provider a counter, its ready check and its probe two switches.
const kindWith = (options: { readonly canUpdateInPlace: boolean; readonly canSample?: boolean }) =>
  Effect.gen(function* () {
    const rows = new Map<Hand.ID, MachineLifecycle.Row<Hand.ID>>()
    const switches = {
      boots: false,
      answers: true,
      connects: true,
      alive: true,
      capacity: false,
      full: false,
      changeAtWake: "current" as "current" | "update" | "replace",
      updates: true,
      wanted: { config: {}, image: Option.none(), hosts: Option.none() } as MachineLifecycle.DesiredSetup,
      applied: Option.none<ReadonlyArray<string>>(),
      system: "system",
      sample: Option.none<MachineProvider.Sample>(),
      held: Option.none<{ readonly entered: Deferred.Deferred<void>; readonly release: Deferred.Deferred<void> }>(),
    }
    const running = new Set<Hand.ID>()
    const images: Array<Option.Option<string>> = []
    const networks: Array<Option.Option<ReadonlyArray<string>>> = []
    const variables: Array<Readonly<Record<string, string>>> = []
    const steps: Array<ReadonlyArray<string>> = []
    const updated: Array<string> = []
    const destroyed: Array<number> = []
    const made = { count: 0 }
    const provider = MachineProvider.make({
      id: MachineProvider.ID.make("memory"),
      title: "Memory",
      description: "Machines in the test’s memory.",
      canEgress: false,
      canMount: false,
      systemImage: "system",
      config: Schema.Struct({
        packages: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
      }),
      binding: Schema.Struct({ number: Schema.Int }),
      // oxlint-disable-next-line ren/no-comments -- A config that only adds packages installs them in place; any other change needs a new machine.
      stepsBetween: (from, to) =>
        from.packages.every((name) => to.packages.includes(name))
          ? Option.some(
              to.packages
                .filter((name) => !from.packages.includes(name))
                .map((name) => ({ command: `install ${name}`, user: "root" as const })),
            )
          : Option.none(),
      create: (input) => {
        images.push(input.image)
        networks.push(input.network.hosts)
        variables.push(input.variables)
        if (switches.capacity || switches.full) {
          switches.capacity = false
          return Effect.fail(new MachineProvider.Capacity({ message: "no room", retryAfter: capacityFor }))
        }
        made.count += 1
        return Effect.succeed({ binding: { number: made.count }, url: `http://machine-${made.count}.test` })
      },
      connect: (binding, network) =>
        switches.connects
          ? Effect.sync(() => {
              networks.push(network.hosts)
              return { url: `http://machine-${binding.number}.test` }
            })
          : Effect.fail(new MachineProvider.Failed({ message: "the provider answered 500" })),
      destroy: (binding) => Effect.sync(() => destroyed.push(binding.number)),
      updateNetwork: (_binding, network) => Effect.sync(() => void networks.push(network.hosts)),
      keepAlive: () =>
        switches.alive ? Effect.void : Effect.fail(new MachineProvider.Gone({ message: "the sandbox is gone" })),
      status: () => Effect.succeed("running" as const),
      ...(options.canSample && { lastSample: () => Effect.sync(() => switches.sample) }),
    })
    const read = (id: Hand.ID) =>
      Effect.sync(() => rows.get(id)).pipe(Effect.flatMap(Effect.fromNullishOr), Effect.orDie)
    const update = (
      id: Hand.ID,
      values: Partial<MachineLifecycle.Row<Hand.ID>>,
      only?: Pick<MachineLifecycle.Row<Hand.ID>, "phase" | "generation">,
    ) =>
      Effect.flatMap(read(id), (row) =>
        Effect.sync(() => {
          if (only && (row.phase !== only.phase || row.generation !== only.generation)) return
          rows.set(id, { ...row, ...values })
        }),
      )
    const holder: { run?: (id: Hand.ID) => Effect.Effect<void, unknown> } = {}
    const machines = MachineLifecycle.make({
      kind: "hand",
      egress: { enabled: false, proxyFor: () => Effect.succeedNone, retire: () => Effect.void },
      workload: (row) => ({ kind: "hand", id: row.id, generation: row.generation }),
      providerOf: () => Effect.sync(() => ({ ...provider, systemImage: switches.system })),
      bootWithin: Duration.seconds(1),
      wakeWithin: Duration.seconds(1),
      find: (id) => Effect.sync(() => Option.fromNullishOr(rows.get(id))),
      update,
      replace: (row) =>
        update(row.id, {
          generation: row.generation + 1,
          binding: null,
          url: null,
          keep_alive_until: null,
          phase: "creating",
        }),
      forceReplace: (id, generation) =>
        Effect.flatMap(read(id), (row) =>
          row.generation === generation && row.phase !== "creating" && row.phase !== "replacing"
            ? update(id, { phase: "replacing" }).pipe(Effect.as(true))
            : Effect.succeed(false),
        ),
      isNeeded: () => Effect.succeed(true),
      // oxlint-disable-next-line ren/no-comments -- Like the durable run: one run per machine at a time; an ensure during it does nothing.
      ensure: (row) =>
        !holder.run || running.has(row.id)
          ? Effect.void
          : Effect.sync(() => running.add(row.id)).pipe(
              Effect.andThen(holder.run(row.id)),
              Effect.ignore,
              Effect.ensuring(Effect.sync(() => running.delete(row.id))),
            ),
      startup: () =>
        Effect.succeed({
          variables: { POSTHOG_PROJECT_KEY: "phc_ren", REN_URL: "https://ren.test" },
          created: Effect.void,
        }),
      desiredSetup: () => Effect.sync(() => switches.wanted),
      appliedHosts: () => Effect.sync(() => switches.applied),
      target: (row) => Option.fromNullishOr(row.url),
      boot: () => Effect.sync(() => (switches.boots ? Option.none() : Option.some("The machine did not answer"))),
      wake: () => Effect.succeed(true),
      changeAtWake: () => Effect.sync(() => switches.changeAtWake),
      ...(options.canUpdateInPlace && {
        updateInPlace: (
          row: MachineLifecycle.Row<Hand.ID>,
          _target: string,
          applied: ReadonlyArray<MachineProvider.Step>,
        ) =>
          Option.match(switches.held, {
            onNone: () => Effect.void,
            onSome: (held) =>
              Deferred.succeed(held.entered, undefined).pipe(Effect.andThen(Deferred.await(held.release))),
          }).pipe(
            Effect.andThen(
              Effect.sync(() => {
                if (!switches.updates) return Option.some("the new version did not answer")
                updated.push(row.id)
                steps.push(applied.map((step) => step.command))
                switches.changeAtWake = "current"
                return Option.none<string>()
              }),
            ),
          ),
      }),
      answers: () => Effect.sync(() => switches.answers),
    })
    holder.run = machines.run
    const add = (values: Partial<MachineLifecycle.Row<Hand.ID>> = {}) => {
      const id = Hand.ID.create()
      rows.set(id, {
        id,
        organization_id: Auth.OrganizationID.create(),
        space_id: Space.ID.create(),
        provider: null,
        binding: null,
        image: null,
        image_template: null,
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
        network_hosts: null,
        ...values,
      })
      return id
    }
    return { machines, switches, destroyed, updated, read, update, add, images, networks, variables, steps }
  })

const kind = kindWith({ canUpdateInPlace: true })

describe("MachineLifecycle", () => {
  it.effect("a new machine gets the names of Ren's own variables, so its executor keeps them from the agent", () =>
    Effect.gen(function* () {
      const memory = yield* kind
      memory.switches.boots = true
      yield* memory.machines.access(memory.add())
      expect(memory.variables).toEqual([
        {
          POSTHOG_PROJECT_KEY: "phc_ren",
          REN_URL: "https://ren.test",
          [ExecutorVariables.hidden]: "POSTHOG_PROJECT_KEY",
        },
      ])
    }),
  )

  it.effect(
    "a machine that fails 3 times waits 10 min, then 30 min, then every hour; the next access after that starts it again",
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

  it.effect("a machine whose provider fails 3 times at its wake fails, and is reported", () =>
    Effect.gen(function* () {
      reports.length = 0
      const memory = yield* kind
      memory.switches.connects = false
      const id = memory.add({ phase: "resuming", binding: { number: 1 } })
      yield* Effect.forEach([1, 2, 3], () => memory.machines.ensure(id), { discard: true })
      expect(yield* memory.read(id)).toMatchObject({ phase: "failed", failures: 3 })
      expect(reports.filter((report) => report.includes("MachineLifecycle.Failed"))).toHaveLength(1)
    }),
  )

  it.effect(
    "an access that finds the machine gone while extending its keep-alive answers Starting, not its old url",
    () =>
      Effect.gen(function* () {
        const memory = yield* kind
        memory.switches.alive = false
        const now = yield* Clock.currentTimeMillis
        const id = memory.add({
          phase: "ready",
          binding: { number: 1 },
          url: "http://machine-1.test",
          keep_alive_until: new Date(now + Duration.toMillis(Duration.minutes(1))),
        })
        expect(yield* memory.machines.access(id)).toEqual({ _tag: "Starting", phase: "replacing" })
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
    "a machine whose brain gives no answer for 5 min while it runs is replaced; an answer in between starts the count again",
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

  it.effect(
    "a running machine that does not answer is kept while its samples are fresh, and replaced once they stop, with the full resource named (B5.5)",
    () =>
      Effect.gen(function* () {
        reports.length = 0
        const memory = yield* kindWith({ canUpdateInPlace: true, canSample: true })
        memory.switches.boots = true
        const id = memory.add()
        yield* memory.machines.access(id)
        memory.switches.answers = false
        memory.switches.sample = Option.some({ at: yield* DateTime.now, memory: 0.4, disk: 0.99 })
        yield* memory.machines.check(id)
        const fresh = yield* memory.read(id)
        yield* TestClock.adjust(Duration.minutes(2))
        yield* memory.machines.check(id)
        expect([fresh.generation, fresh.phase]).toEqual([1, "ready"])
        expect(yield* memory.read(id)).toMatchObject({ phase: "ready", generation: 2 })
        expect(reports).toEqual([
          `MachineLifecycle.Replaced: Environment ${id}: its machine stopped with its disk full`,
        ])
      }),
  )

  it.effect("waiting for capacity is reported once, with the provider's reason", () =>
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

  it.effect("a stopped machine answers Stopped to an access and makes nothing; a retry starts it again", () =>
    Effect.gen(function* () {
      const memory = yield* kind
      memory.switches.boots = true
      const id = memory.add({ phase: "stopped", generation: 2 })
      expect(yield* memory.machines.access(id)).toEqual({ _tag: "Stopped" })
      expect(memory.images).toHaveLength(0)
      yield* memory.machines.retry(id)
      expect(yield* memory.read(id)).toMatchObject({ phase: "ready", generation: 2 })
      expect(memory.images).toHaveLength(1)
    }),
  )

  it.effect("a change made while a machine waits for capacity stays: the wait does not write its old phase back", () =>
    Effect.gen(function* () {
      const memory = yield* kind
      memory.switches.boots = true
      memory.switches.capacity = true
      const id = memory.add()
      const access = yield* memory.machines.access(id).pipe(Effect.forkChild)
      yield* TestClock.adjust(Duration.seconds(1))
      expect(yield* memory.read(id)).toMatchObject({ phase: "capacity", generation: 1 })
      yield* memory.update(id, { phase: "failed", generation: 2 })
      yield* TestClock.adjust(capacityFor)
      yield* Fiber.join(access)
      expect(yield* memory.read(id)).toMatchObject({ phase: "failed", generation: 2 })
      expect(memory.images).toHaveLength(1)
    }),
  )

  it.effect(
    "a wait for a machine whose provider stays full ends after boot and wake time as Starting, so the caller tries again",
    () =>
      Effect.gen(function* () {
        const memory = yield* kind
        memory.switches.full = true
        const id = memory.add()
        const ready = yield* memory.machines.ready(id).pipe(Effect.flip, Effect.forkChild)
        yield* TestClock.adjust(Duration.minutes(10))
        expect(ready.pollUnsafe()).toBeDefined()
        expect((yield* Fiber.join(ready))._tag).toBe("MachineLifecycle.Starting")
      }),
  )
})

describe("MachineLifecycle keep-awake", () => {
  it.effect(
    "a turn that runs one 40-min command with no progress keeps its machine awake to the end, with a cron's access every 2 min",
    () =>
      Effect.gen(function* () {
        const memory = yield* kind
        memory.switches.boots = true
        const id = memory.add()
        yield* memory.machines.access(id)
        yield* memory.update(id, { last_progress_at: new Date(yield* Clock.currentTimeMillis) })
        const seen = yield* Effect.forEach(
          Array.from({ length: 80 }, (_, index) => index + 1),
          (pull) =>
            Effect.gen(function* () {
              yield* TestClock.adjust(Duration.seconds(30))
              const row = yield* memory.read(id)
              yield* memory.machines.keepAwake(row, { isBusy: true, hasBackground: true })
              const access = pull % 4 === 0 ? (yield* memory.machines.access(id))._tag : "Ready"
              const left =
                ((yield* memory.read(id)).keep_alive_until?.getTime() ?? 0) - (yield* Clock.currentTimeMillis)
              return access === "Ready" && left > 0
            }),
        )
        expect(seen.filter((awake) => !awake)).toHaveLength(0)
      }),
  )

  it.effect(
    "a background process keeps an idle machine awake up to 2 h after the last turn's progress, and no longer",
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

describe("MachineLifecycle updates", () => {
  const asleep = Effect.fnUntraced(function* () {
    const memory = yield* kind
    memory.switches.boots = true
    const id = memory.add()
    yield* memory.machines.access(id)
    yield* TestClock.adjust(Duration.minutes(11))
    return { memory, id }
  })

  it.effect("an outdated machine updates in place when it wakes, and keeps its generation", () =>
    Effect.gen(function* () {
      const found = yield* asleep()
      found.memory.switches.changeAtWake = "update"
      expect((yield* found.memory.machines.access(found.id))._tag).toBe("Starting")
      expect(found.memory.updated).toEqual([found.id])
      expect(yield* found.memory.read(found.id)).toMatchObject({ phase: "ready", generation: 1 })
    }),
  )

  it.effect(
    "an access during an update in place answers Starting, never the old url, and the machine is ready once, on its generation, when the update ends",
    () =>
      Effect.gen(function* () {
        const found = yield* asleep()
        found.memory.switches.changeAtWake = "update"
        const held = { entered: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() }
        found.memory.switches.held = Option.some(held)
        const first = yield* found.memory.machines.access(found.id).pipe(Effect.forkChild)
        yield* Deferred.await(held.entered)
        const during = yield* found.memory.machines.access(found.id)
        const phase = (yield* found.memory.read(found.id)).phase
        yield* Deferred.succeed(held.release, undefined)
        yield* Fiber.join(first)
        const after = yield* found.memory.machines.access(found.id)
        expect([during._tag, phase, after._tag, found.memory.updated]).toEqual([
          "Starting",
          "updating",
          "Ready",
          [found.id],
        ])
        expect(yield* found.memory.read(found.id)).toMatchObject({ phase: "ready", generation: 1 })
      }),
  )

  it.effect("an update that fails 3 times replaces the machine", () =>
    Effect.gen(function* () {
      const found = yield* asleep()
      found.memory.switches.changeAtWake = "update"
      found.memory.switches.updates = false
      yield* found.memory.machines.access(found.id)
      expect(yield* found.memory.read(found.id)).toMatchObject({ phase: "ready", generation: 2 })
      expect(found.memory.destroyed).toHaveLength(1)
    }),
  )

  it.effect("a machine that cannot update in place is replaced at its wake", () =>
    Effect.gen(function* () {
      const found = yield* asleep()
      found.memory.switches.changeAtWake = "replace"
      yield* found.memory.machines.access(found.id)
      found.memory.switches.changeAtWake = "current"
      expect(yield* found.memory.read(found.id)).toMatchObject({ generation: 2 })
    }),
  )

  const templateImage = (
    name: string,
    packages: ReadonlyArray<string>,
    environmentTemplateId = templateId,
    system = "ren-brain:a1b2",
  ) => ({
    config: {},
    image: Option.some({ name, template: { environmentTemplateId, config: { packages }, system } }),
    hosts: Option.some(["api.example.com"]),
  })

  it.effect(
    "a template that only adds a package reaches an asleep machine in place at its wake, also a change made while it was created",
    () =>
      Effect.gen(function* () {
        const memory = yield* kind
        memory.switches.boots = true
        memory.switches.wanted = templateImage("image-a", ["ffmpeg"])
        const id = memory.add()
        yield* memory.machines.access(id)
        memory.switches.wanted = templateImage("image-b", ["ffmpeg", "requests"])
        yield* TestClock.adjust(Duration.minutes(11))
        yield* memory.machines.access(id)
        expect(memory.images).toEqual([Option.some("image-a")])
        expect(memory.steps).toEqual([["install requests"]])
        expect(memory.networks.at(-1)).toEqual(Option.some(["api.example.com"]))
        expect(yield* memory.read(id)).toMatchObject({
          phase: "ready",
          generation: 1,
          image: "image-b",
          image_template: {
            environmentTemplateId: templateId,
            config: { packages: ["ffmpeg", "requests"] },
            system: "ren-brain:a1b2",
          },
        })
      }),
  )

  it.effect("a new system image replaces an asleep machine at its wake, and the same one keeps it", () =>
    Effect.gen(function* () {
      const memory = yield* kind
      memory.switches.boots = true
      memory.switches.system = "ren-brain:a1b2"
      const id = memory.add()
      yield* memory.machines.access(id)
      const wakeOn = (system: string) =>
        Effect.gen(function* () {
          memory.switches.system = system
          yield* TestClock.adjust(Duration.minutes(11))
          yield* memory.machines.access(id)
          return (yield* memory.read(id)).generation
        })
      expect(yield* wakeOn("ren-brain:a1b2")).toBe(1)
      expect(yield* wakeOn("ren-brain:c3d4")).toBe(2)
      expect((yield* memory.read(id)).image).toBe("ren-brain:c3d4")
    }),
  )

  it.effect(
    "a template built again on a new system image replaces an asleep machine at its wake, with no steps in place",
    () =>
      Effect.gen(function* () {
        const memory = yield* kind
        memory.switches.boots = true
        memory.switches.wanted = templateImage("image-a", ["ffmpeg"])
        const id = memory.add()
        yield* memory.machines.access(id)
        memory.switches.wanted = templateImage("image-a2", ["ffmpeg"], templateId, "ren-brain:c3d4")
        yield* TestClock.adjust(Duration.minutes(11))
        yield* memory.machines.access(id)
        expect(yield* memory.read(id)).toMatchObject({ generation: 2, image: "image-a2" })
        expect(memory.steps).toEqual([])
      }),
  )

  it.effect("a removed package, another template or no template replaces the machine at its wake", () =>
    Effect.gen(function* () {
      const memory = yield* kind
      memory.switches.boots = true
      memory.switches.wanted = templateImage("image-a", ["ffmpeg", "requests"])
      const id = memory.add()
      yield* memory.machines.access(id)
      const wakeWith = (wanted: MachineLifecycle.DesiredSetup) =>
        Effect.gen(function* () {
          memory.switches.wanted = wanted
          yield* TestClock.adjust(Duration.minutes(11))
          yield* memory.machines.access(id)
          return (yield* memory.read(id)).generation
        })
      expect(yield* wakeWith(templateImage("image-b", ["ffmpeg"]))).toBe(2)
      expect(yield* wakeWith(templateImage("image-c", ["ffmpeg", "git"], MachineTemplate.ID.create()))).toBe(3)
      expect(yield* wakeWith({ config: {}, image: Option.none(), hosts: Option.none() })).toBe(4)
      expect(memory.images).toEqual([
        Option.some("image-a"),
        Option.some("image-b"),
        Option.some("image-c"),
        Option.none(),
      ])
      expect(memory.steps).toEqual([])
    }),
  )

  it.effect(
    "an awake machine gets its applied template's changed host list at once, never a newer template's, and the provider hears nothing when it did not change",
    () =>
      Effect.gen(function* () {
        const memory = yield* kind
        memory.switches.boots = true
        memory.switches.wanted = { config: {}, image: Option.none(), hosts: Option.some(["api.example.com"]) }
        memory.switches.applied = memory.switches.wanted.hosts
        const id = memory.add()
        yield* memory.machines.access(id)
        yield* memory.machines.refreshNetwork(id)
        memory.switches.wanted = { config: {}, image: Option.none(), hosts: Option.some(["pending.example.com"]) }
        yield* memory.machines.refreshNetwork(id)
        memory.switches.applied = Option.some(["api.example.com", "github.com"])
        yield* memory.machines.refreshNetwork(id)
        yield* memory.machines.refreshNetwork(id)
        expect(memory.networks).toEqual([
          Option.some(["api.example.com"]),
          Option.some(["api.example.com", "github.com"]),
        ])
        expect((yield* memory.read(id)).network_hosts).toEqual(["api.example.com", "github.com"])
      }),
  )

  it.effect(
    "a kind that cannot update in place is replaced at its wake for a package its template adds, with no failed update",
    () =>
      Effect.gen(function* () {
        const memory = yield* kindWith({ canUpdateInPlace: false })
        memory.switches.boots = true
        memory.switches.wanted = templateImage("image-a", ["ffmpeg"])
        const id = memory.add()
        yield* memory.machines.access(id)
        memory.switches.wanted = templateImage("image-b", ["ffmpeg", "requests"])
        yield* TestClock.adjust(Duration.minutes(11))
        yield* memory.machines.access(id)
        expect(yield* memory.read(id)).toMatchObject({ generation: 2, image: "image-b", failures: 0 })
      }),
  )
})
