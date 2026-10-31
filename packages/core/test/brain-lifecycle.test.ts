import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Space } from "@ren/schema/space"
import { eq } from "drizzle-orm"
import { Effect, Option, Schedule } from "effect"
import { Brains } from "../src/brains.js"
import { BrainLifecycle } from "../src/brain-lifecycle.js"
import { SandboxProvider } from "../src/sandbox-provider.js"
import { E2BSandbox } from "../src/sandbox-provider/e2b.js"
import { BrainRuns } from "./lib/brain-runs.js"

setDefaultTimeout(120_000)

const runs = await BrainRuns.make()

beforeAll(() => runs.setup())

afterAll(() => runs.dispose())

describe("brain runs", () => {
  test("cleanup destroys a provider sandbox whose brain row does not exist", async () => {
    const current = await runs.ren()
    const created = await current.runPromise(
      SandboxProvider.Service.use((provider) =>
        provider.create({
          brainId: Brain.ID.create(),
          generation: 1,
          organizationId: Auth.OrganizationID.create(),
          spaceId: Space.ID.create(),
          env: {},
          proxy: Option.none(),
        }),
      ),
    )
    const pid = BrainRuns.pidOf(created.binding)
    expect(BrainRuns.isAlive(pid)).toBe(true)
    await current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.cleanup))
    expect(BrainRuns.isAlive(pid)).toBe(false)
    await current.dispose()
  })

  test("a start gives up when its creator can no longer see the space, and the brain does not start", async () => {
    const found = await runs.seeded()
    const current = await runs.ren()
    await runs.database.runPromise(
      Effect.gen(function* () {
        const db = yield* Database.Service
        yield* db.db
          .delete(Database.Schema.member)
          .where(eq(Database.Schema.member.organizationId, found.organizationId))
      }),
    )
    const input = { sessionId: found.sessionId, harness: "opencode" as const, interactive: false }
    const placement = { organizationId: found.organizationId, spaceId: found.spaceId, brainId: found.brainId }
    await current.runPromise(Brains.Service.use((host) => host.start(input, placement)))
    await current.runPromise(
      Brains.StartRun.poll(await Effect.runPromise(Brains.StartRun.executionId({ input, placement, epoch: 0 }))).pipe(
        Effect.repeat({ until: Option.isSome, schedule: Schedule.spaced("100 millis") }),
        Effect.timeoutOrElse({
          duration: "20 seconds",
          orElse: () => Effect.die(new Error("The start did not give up")),
        }),
      ),
    )
    expect((await runs.row(found.brainId)).binding).toBeNull()
    await current.dispose()
  })
})

// oxlint-disable-next-line ren/no-comments -- Live: calls E2B with the development key (README §7). script/test.ts removes E2B_ variables, so run it with `E2B_API_KEY=… bun test test/brain-lifecycle.test.ts -t E2B`.
describe.skipIf(!process.env.E2B_API_KEY)("an E2B brain", () => {
  test("E2B: a template tag that E2B does not have fails with the tag in the reason, and the third failure gives failed (G4, E81)", async () => {
    const found = await runs.seeded()
    const current = await runs.ren({
      sandbox: E2BSandbox.layer,
      config: {
        E2B_API_KEY: process.env.E2B_API_KEY ?? "",
        E2B_TEMPLATE: "ren-brain-dev:0000000000000000",
        E2B_VCPU_SECOND_MICRO_USD: "14",
        E2B_GIB_SECOND_MICRO_USD: "4.5",
      },
    })
    await current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(found.brainId)))
    await runs.reaches(found.brainId, "failed")
    expect(await runs.row(found.brainId)).toMatchObject({
      failures: 3,
      failure: expect.stringContaining("tag '0000000000000000' does not exist"),
    })
    await current.dispose()
  })
})
