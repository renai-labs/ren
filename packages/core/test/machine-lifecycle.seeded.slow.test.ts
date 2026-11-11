import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { BrainProvider } from "../src/brain-provider.js"
import { Brain } from "@ren/schema/brain"
import { Effect, Option, Random, Schema } from "effect"
import { BrainLifecycle } from "../src/brain-lifecycle.js"
import { MachineProvider } from "../src/machine-provider.js"
import { BrainRuns } from "./lib/brain-runs.js"
import { Host } from "./lib/host.js"

setDefaultTimeout(600_000)

const seeds = Number(process.env.SEEDED_RUNS ?? 4)

const firstSeed = Number(process.env.SEEDED_FROM ?? 20_261_106)

const length = Number(process.env.SEEDED_EVENTS ?? 12)

const events = [
  "access",
  "access",
  "check",
  "check",
  "kill",
  "freeze",
  "unknown-status",
  "partial-list",
  "cleanup",
  "restart-ren",
] as const

type Event = (typeof events)[number]

const runs = await BrainRuns.make()

afterAll(() => runs.dispose())

interface Destroyed {
  readonly id: string
  readonly generation: number
  readonly rowGeneration: number
  readonly rowPhase: string
  readonly wasAlive: boolean
}

// oxlint-disable-next-line ren/no-comments -- The local provider, with the faults a seed turns on: a status and samples that fail (I11), a list that shows only part of the machines (I12). It records each destroy with the row it saw, and lists the real machines for the checks.
const faulty = () => {
  const faults = { status: false, partialList: false, recording: true }
  const destroyed: Array<Destroyed> = []
  const frozen = new Set<number>()
  const real: { list?: MachineProvider.Provider["list"] } = {}
  const layer = BrainProvider.layer([
    Effect.gen(function* () {
      const provider = yield* Host.local({ root: runs.root, lostEvery: "500 millis" })
      real.list = provider.list
      const unknown = Effect.fail(new MachineProvider.Failed({ message: "the seeded fault: no answer" }))
      return {
        ...provider,
        status: (binding) => (faults.status ? unknown : provider.status(binding)),
        lastSample: Option.map(
          provider.lastSample,
          (lastSample) => (binding: Schema.Json) => (faults.status ? unknown : lastSample(binding)),
        ),
        list: Effect.suspend(() =>
          faults.partialList ? Effect.map(provider.list, (all) => all.slice(1)) : provider.list,
        ),
        destroy: (binding) =>
          Effect.gen(function* () {
            const listed = (yield* provider.list.pipe(Effect.orDie)).find(
              (each) => JSON.stringify(each.binding) === JSON.stringify(binding),
            )
            if (faults.recording && listed && Schema.is(Brain.ID)(listed.id)) {
              const id = listed.id
              const row = yield* Effect.promise(() => runs.row(id))
              destroyed.push({
                id: listed.id,
                generation: listed.generation,
                rowGeneration: row.generation,
                rowPhase: row.phase,
                wasAlive: BrainRuns.isAlive(BrainRuns.pidOf(binding)),
              })
            }
            return yield* provider.destroy(binding)
          }),
      } satisfies MachineProvider.Provider
    }),
  ])
  return { faults, destroyed, frozen, layer, real }
}

describe("seeded machine lifecycle runs on the local provider", () => {
  const lane: { close: () => Promise<void> } = { close: async () => {} }

  afterEach(async () => {
    await lane.close()
    lane.close = async () => {}
  })

  test.each(Array.from({ length: seeds }, (_, index) => firstSeed + index))(
    `seed %i: ${length} events keep I1, I2, I3, I11 and I12`,
    async (seed) => {
      const plan = Effect.runSync(
        Effect.forEach(Array.from({ length }), () =>
          Effect.all({ event: Random.choice(events), gapMs: Random.nextIntBetween(0, 1_500) }),
        ).pipe(Random.withSeed(seed)),
      )
      const fixture = faulty()
      const start = () => runs.ren({ sandbox: fixture.layer, keepBrains: true, lostEvery: "500 millis" })
      const state = { ren: await start(), kills: 0 }
      lane.close = async () => {
        fixture.faults.recording = false
        await state.ren.dispose()
      }
      const brainId = await runs.newBrain()
      const lifecycle = <A>(use: (service: BrainLifecycle.Interface) => Effect.Effect<A>) =>
        state.ren.runPromise(BrainLifecycle.Service.use(use))
      const machines = async () => {
        const list = fixture.real.list
        if (!list) throw new Error("the provider did not start")
        return state.ren.runPromise(list.pipe(Effect.orDie))
      }
      await lifecycle((service) => service.ready(brainId).pipe(Effect.orDie))

      const run: Readonly<Record<Event, () => Promise<unknown>>> = {
        access: () => lifecycle((service) => service.access(brainId)),
        check: () => lifecycle((service) => service.check(brainId)),
        cleanup: () => lifecycle((service) => service.cleanup),
        kill: async () => {
          const row = await runs.row(brainId)
          if (!row.binding) return
          state.kills += 1
          Bun.spawnSync(["kill", "-KILL", `-${BrainRuns.pidOf(row.binding)}`])
        },
        freeze: async () => {
          const row = await runs.row(brainId)
          if (!row.binding) return
          const pid = BrainRuns.brainOf(row.binding)
          if (!pid) return
          Bun.spawnSync(["kill", "-STOP", String(pid)])
          fixture.frozen.add(pid)
        },
        "unknown-status": async () => {
          fixture.faults.status = !fixture.faults.status
        },
        "partial-list": async () => {
          fixture.faults.partialList = !fixture.faults.partialList
        },
        "restart-ren": async () => {
          await state.ren.dispose()
          state.ren = await start()
        },
      }

      for (const step of plan) {
        await run[step.event]()
        // ast-grep-ignore: no-test-sleep -- the seeded gap between two events is part of the sequence
        await Bun.sleep(step.gapMs)
        const listed = await machines()
        const generations = listed.map((each) => `${each.id}:${each.generation}`)
        expect(new Set(generations).size, `I1 after ${step.event}`).toBe(generations.length)
      }

      fixture.faults.status = false
      fixture.faults.partialList = false
      for (const pid of fixture.frozen) Bun.spawnSync(["kill", "-CONT", String(pid)])
      await lifecycle((service) =>
        service.ready(brainId).pipe(
          Effect.catch(() => service.retry(brainId).pipe(Effect.andThen(service.ready(brainId)))),
          Effect.orDie,
        ),
      )
      const settled = await runs.row(brainId)
      expect(settled.phase, "I2").toBe("ready")
      if (state.kills === 0) expect(settled.generation, "I3: no machine was lost").toBe(1)
      await lifecycle((service) => service.cleanup)
      const listed = await machines()
      expect(
        listed.filter((each) => each.id === brainId).map((each) => each.generation),
        "I1: after cleanup, one machine, of the row's generation",
      ).toEqual([settled.generation])
      expect(
        fixture.destroyed.filter(
          (each) => each.wasAlive && !(each.generation === each.rowGeneration && each.rowPhase === "booting"),
        ),
        "I3, I11 and I12: a machine that runs is destroyed only when it did not boot",
      ).toEqual([])
    },
  )
})
