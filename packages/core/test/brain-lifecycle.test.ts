import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Shared } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { SqlClient } from "effect/sql"
import { Brain } from "@ren/schema/brain"
import { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { eq, inArray } from "drizzle-orm"
import { type Duration, Effect, Layer, ManagedRuntime, Option, Schedule, Schema } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Brains } from "../src/brains.js"
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

const ren = async (
  options: {
    readonly lostEvery?: Duration.Input
    readonly maxRunning?: number
    readonly root?: string
    readonly template?: string
  } = {},
) =>
  ManagedRuntime.make(
    Host.serve(port).pipe(
      Layer.provideMerge(Host.stack({ port, root, config: {}, models, environments: Host.noTemplates, ...options })),
      Layer.provide(
        Layer.succeedContext(await database.runPromise(Effect.context<Database.Service | SqlClient.SqlClient>())),
      ),
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

const seeded = () =>
  database.runPromise(
    Effect.gen(function* () {
      const organizationId = yield* Seed.organization()
      const spaceId = yield* Seed.space(organizationId)
      const creator = yield* Seed.user()
      const brainId = Brain.ID.create()
      const sessionId = yield* Seed.session({ organizationId, spaceId, createdBy: creator.id, brainId })
      return { brainId, sessionId, spaceId, organizationId }
    }),
  )

const newBrain = () => seeded().then((found) => found.brainId)

const busy = (sessionId: Session.ID) =>
  database.runPromise(
    Effect.gen(function* () {
      const db = yield* Database.Service
      yield* db.db.insert(Database.Schema.opencode_session).values({
        session_id: sessionId,
        project_id: "global",
        slug: "busy",
        directory: "/home/user/workspace",
        version: "2",
        cost: 0,
        tokens_input: 0,
        tokens_output: 0,
        tokens_reasoning: 0,
        tokens_cache_read: 0,
        tokens_cache_write: 0,
        time_created: Date.now(),
        time_updated: Date.now(),
        time_suspended: Date.now(),
      })
    }),
  )

const outcome = (sessionId: Session.ID) =>
  database.runPromise(
    Effect.gen(function* () {
      const db = yield* Database.Service
      return (yield* db.db
        .select({ outcome: Database.Schema.opencode_session.idle_outcome })
        .from(Database.Schema.opencode_session)
        .where(eq(Database.Schema.opencode_session.session_id, sessionId))).at(0)?.outcome
    }),
  )

const archive = (table: "session" | "space", found: { readonly sessionId: Session.ID; readonly spaceId: Space.ID }) =>
  database.runPromise(
    Effect.gen(function* () {
      const db = yield* Database.Service
      if (table === "session")
        yield* db.db
          .update(Database.Schema.agent_session)
          .set({ archived_at: new Date() })
          .where(eq(Database.Schema.agent_session.id, found.sessionId))
      else
        yield* db.db
          .update(Database.Schema.space)
          .set({ archived_at: new Date() })
          .where(eq(Database.Schema.space.id, found.spaceId))
    }),
  )

const isAlive = (pid: number) => Bun.spawnSync(["kill", "-0", String(pid)]).exitCode === 0

const pidOf = (binding: unknown) => Schema.decodeUnknownSync(Schema.Struct({ pid: Schema.Int }))(binding).pid

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

  test("a sandbox that is gone marks its brain's busy chats interrupted and the brain replacing, with no access", async () => {
    const found = await seeded()
    const current = await ren()
    await current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(found.brainId)))
    const ready = await reaches(found.brainId, "ready")
    await busy(found.sessionId)
    const binding = Schema.decodeUnknownSync(Schema.Struct({ pid: Schema.Int }))(ready.binding)
    process.kill(-binding.pid, "SIGKILL")
    await reaches(found.brainId, "replacing")
    expect(await outcome(found.sessionId)).toBe("interrupted")
    await current.dispose()
  })

  test("a call that finds its brain's sandbox gone marks the brain replacing, for providers without lost events", async () => {
    const found = await seeded()
    const current = await ren({ lostEvery: "1 hour" })
    await current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(found.brainId)))
    const ready = await reaches(found.brainId, "ready")
    const binding = Schema.decodeUnknownSync(Schema.Struct({ pid: Schema.Int }))(ready.binding)
    process.kill(-binding.pid, "SIGKILL")
    const failed = await current.runPromise(
      Brains.Service.use((host) =>
        host.send({
          sessionId: found.sessionId,
          messageId: Session.MessageID.create(),
          prompt: { text: "hello" },
          delivery: "steer",
          sender: { userId: "user_1" },
        }),
      ).pipe(Effect.flip),
    )
    expect(failed._tag).toBe("BrainUnavailable")
    expect((await row(found.brainId)).phase).toBe("replacing")
    await current.dispose()
  })

  test("cleanup destroys the sandbox of a brain with all chats archived or its space archived, and keeps the others", async () => {
    const current = await ren()
    const brains = await Promise.all([seeded(), seeded(), seeded()])
    await Promise.all(
      brains.map((found) =>
        current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(found.brainId))),
      ),
    )
    const pids = await Promise.all(
      brains.map((found) => reaches(found.brainId, "ready").then((ready) => pidOf(ready.binding))),
    )
    const archivedChats = brains[0]
    const archivedSpace = brains[1]
    await archive("session", archivedChats)
    await archive("space", archivedSpace)
    await current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.cleanup))
    expect(pids.map(isAlive)).toEqual([false, false, true])
    expect((await row(archivedChats.brainId)).binding).toBeNull()
    expect((await row(archivedSpace.brainId)).binding).toBeNull()
    await current.dispose()
  })

  test("cleanup destroys a provider sandbox whose brain row does not exist", async () => {
    const current = await ren()
    const created = await current.runPromise(
      SandboxProvider.Service.use((provider) =>
        provider.create({ brainId: Brain.ID.create(), generation: 1, env: {} }),
      ),
    )
    const pid = pidOf(created.binding)
    expect(isAlive(pid)).toBe(true)
    await current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.cleanup))
    expect(isAlive(pid)).toBe(false)
    await current.dispose()
  })

  test("a start for a failed brain gives up, and Retry with the first message starts the chat", async () => {
    const found = await seeded()
    const current = await ren()
    await database.runPromise(
      Effect.gen(function* () {
        const db = yield* Database.Service
        yield* db.db
          .update(Database.Schema.brain)
          .set({ phase: "failed", failures: 3, failure: "the template is broken", run_epoch: 1 })
          .where(eq(Database.Schema.brain.id, found.brainId))
      }),
    )
    const script = stub.script({ reply: "started" })
    const input = {
      sessionId: found.sessionId,
      harness: "opencode" as const,
      interactive: false,
      initialMessage: {
        messageId: Session.MessageID.create(),
        prompt: { text: `${script.marker} hello` },
        sender: { userId: "user_1" },
      },
    }
    const placement = { organizationId: found.organizationId, spaceId: found.spaceId, brainId: found.brainId }
    await current.runPromise(Brains.Service.use((host) => host.start(input, placement)))
    await current.runPromise(
      Brains.StartRun.poll(await Effect.runPromise(Brains.StartRun.executionId({ input, placement, epoch: 1 }))).pipe(
        Effect.repeat({ until: Option.isSome, schedule: Schedule.spaced("100 millis") }),
        Effect.timeoutOrElse({
          duration: "20 seconds",
          orElse: () => Effect.die(new Error("The start did not give up")),
        }),
      ),
    )
    await current.runPromise(Brains.Service.use((host) => host.retry(found.sessionId)))
    await current.runPromise(Brains.Service.use((host) => host.start(input, placement)))
    await script.called(1)
    await current.dispose()
  })

  test("a start gives up when its creator can no longer see the space, and the brain does not start", async () => {
    const found = await seeded()
    const current = await ren()
    await database.runPromise(
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
    expect((await row(found.brainId)).binding).toBeNull()
    await current.dispose()
  })

  test("a brain waits for capacity without counting a failure, and starts once a sandbox stops", async () => {
    const first = await seeded()
    const second = await seeded()
    const own = await mkdtemp(join(tmpdir(), "ren-core-brains-"))
    const current = await ren({ maxRunning: 1, root: own })
    const lifecycle = (use: (lifecycle: BrainLifecycle.Interface) => Effect.Effect<unknown, unknown>) =>
      current.runPromise(BrainLifecycle.Service.use(use))
    await lifecycle((each) => each.ensure(first.brainId))
    const running = await reaches(first.brainId, "ready")
    const waiting = await lifecycle((each) =>
      each.access(second.brainId).pipe(
        Effect.repeat({
          until: (access) => access._tag === "Starting" && access.phase === "waiting for capacity",
          schedule: Schedule.spaced("200 millis"),
        }),
        Effect.timeout("20 seconds"),
      ),
    )
    expect(waiting).toEqual({ _tag: "Starting", phase: "waiting for capacity" })
    expect((await row(second.brainId)).failures).toBe(0)
    process.kill(-pidOf(running.binding), "SIGKILL")
    await reaches(second.brainId, "ready")
    await current.runPromise(Effect.scoped(Layer.build(Host.destroyBrains)))
    await current.dispose()
    await rm(own, { recursive: true, force: true })
  })

  test("a paused brain on an older build is replaced with the provider's build at its next access; a running one keeps its build", async () => {
    const paused = await newBrain()
    const running = await newBrain()
    const runtime = await ren({ template: "t2" })
    await runtime.runPromise(
      BrainLifecycle.Service.use((lifecycle) =>
        Effect.all([lifecycle.ensure(paused), lifecycle.ensure(running)], { discard: true }),
      ),
    )
    await Promise.all([reaches(paused, "ready"), reaches(running, "ready")])
    await database.runPromise(
      Effect.gen(function* () {
        const db = yield* Database.Service
        yield* db.db
          .update(Database.Schema.brain)
          .set({ template: "t1" })
          .where(inArray(Database.Schema.brain.id, [paused, running]))
        yield* db.db
          .update(Database.Schema.brain)
          .set({ keep_alive_until: new Date(Date.now() - 1000) })
          .where(eq(Database.Schema.brain.id, paused))
      }),
    )
    await runtime.runPromise(
      BrainLifecycle.Service.use((lifecycle) =>
        Effect.all([lifecycle.access(paused), lifecycle.access(running)], { discard: true }),
      ),
    )
    const replaced = await Effect.runPromise(
      Effect.promise(() => row(paused)).pipe(
        Effect.repeat({
          until: (found) => found.generation === 2 && found.phase === "ready",
          schedule: Schedule.spaced("100 millis"),
        }),
        Effect.timeoutOrElse({
          duration: "60 seconds",
          orElse: () => Effect.die(new Error("The brain was not replaced")),
        }),
      ),
    )
    expect([replaced.template, (await row(running)).generation, (await row(running)).template]).toEqual(["t2", 1, "t1"])
    await runtime.dispose()
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
