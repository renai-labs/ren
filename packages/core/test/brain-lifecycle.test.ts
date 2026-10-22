import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Shared } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { SqlClient } from "effect/sql"
import { Brain } from "@ren/schema/brain"
import { eq } from "drizzle-orm"
import { Effect, Layer, ManagedRuntime, Schedule } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BrainLifecycle } from "../src/brain-lifecycle.js"
import { Models } from "../src/models.js"
import { SandboxProvider } from "../src/sandbox-provider.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(120_000)

const stub = Shared.stub()

const models = Layer.succeed(
  Models.Service,
  Models.Service.of({
    catalog: () => Effect.succeed({ endpoints: [] }),
    grant: () => Effect.sync(() => Shared.access({ stub: Shared.apiKey("sk-lifecycle") }, stub.url)),
  }),
)

const database = ManagedRuntime.make(Testing.layer)
const port = await Effect.runPromise(Host.freePort)
const root = await mkdtemp(join(tmpdir(), "ren-core-brains-"))

const ren = async () =>
  ManagedRuntime.make(
    Host.serve(port).pipe(
      Layer.provideMerge(Host.stack({ port, root, config: {}, models, environments: Host.noTemplates })),
      Layer.provide(Layer.succeedContext(await database.runPromise(Effect.context<Database.Service | SqlClient.SqlClient>()))),
    ),
  )

const row = (brainId: Brain.ID) =>
  database.runPromise(
    Effect.gen(function* () {
      const db = yield* Database.Service
      const found = (yield* db.db.select().from(Database.Schema.brain).where(eq(Database.Schema.brain.id, brainId))).at(
        0,
      )
      if (!found) return yield* Effect.die(new Error(`Brain ${brainId} does not exist`))
      return found
    }),
  )

const reaches = (brainId: Brain.ID, phase: Brain.Phase) =>
  Effect.runPromise(
    Effect.promise(() => row(brainId)).pipe(
      Effect.repeat({ until: (found) => found.phase === phase, schedule: Schedule.spaced("100 millis") }),
      Effect.timeoutOrElse({
        duration: "60 seconds",
        orElse: () => Effect.die(new Error(`Brain ${brainId} did not reach ${phase}`)),
      }),
    ),
  )

const setPhase = (brainId: Brain.ID, phase: Brain.Phase) =>
  database.runPromise(
    Effect.gen(function* () {
      const db = yield* Database.Service
      yield* db.db.update(Database.Schema.brain).set({ phase }).where(eq(Database.Schema.brain.id, brainId))
    }),
  )

const newBrain = () =>
  database.runPromise(
    Effect.gen(function* () {
      const organizationId = yield* Seed.organization()
      const spaceId = yield* Seed.space(organizationId)
      const creator = yield* Seed.user()
      const brainId = Brain.ID.create()
      yield* Seed.session({ organizationId, spaceId, createdBy: creator.id, brainId })
      return brainId
    }),
  )

describe("brain runs", () => {
  beforeAll(() => database.runPromise(Seed.ren()))

  afterAll(async () => {
    const last = await ren()
    await last.runPromise(Effect.scoped(Layer.build(Host.destroyBrains)))
    await last.dispose()
    await database.dispose()
    await rm(root, { recursive: true, force: true })
  })

  test("a run that Ren stopped while the brain booted continues after Ren starts again, on the same sandbox", async () => {
    const brainId = await newBrain()
    const first = await ren()
    await first.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(brainId)))
    const booting = await reaches(brainId, "booting")
    await first.dispose()
    const second = await ren()
    const ready = await reaches(brainId, "ready")
    expect(ready.binding).toEqual(booting.binding)
    const sandboxes = await second.runPromise(SandboxProvider.Service.use((provider) => provider.list))
    expect(sandboxes.filter((each) => each.brainId === brainId)).toHaveLength(1)
    await second.dispose()
  })

  test("a brain run that ended runs again when the brain needs it", async () => {
    const brainId = await newBrain()
    const current = await ren()
    await current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(brainId)))
    await reaches(brainId, "ready")
    await setPhase(brainId, "resuming")
    await current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(brainId)))
    await reaches(brainId, "ready")
    await current.dispose()
  })
})
