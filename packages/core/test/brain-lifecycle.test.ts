import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Shared } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { SqlClient } from "effect/sql"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { eq, inArray } from "drizzle-orm"
import { DateTime, Duration, Effect, Layer, ManagedRuntime, Option, Schedule, Schema } from "effect"
import type { HttpClient } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Brains } from "../src/brains.js"
import { BrainClient } from "../src/brain-client.js"
import { BrainHost } from "../src/brain-host.js"
import { BrainLifecycle } from "../src/brain-lifecycle.js"
import { Models } from "../src/models.js"
import { SandboxProvider } from "../src/sandbox-provider.js"
import { E2BSandbox } from "../src/sandbox-provider/e2b.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(120_000)

const stub = Shared.stub()

const models = Layer.succeed(
  Models.Service,
  Models.Service.of({
    inference: Shared.inference(),
    revision: Effect.succeed("test"),
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
    readonly port?: number
    readonly around?: Parameters<typeof Host.serve>[1]
    readonly config?: Record<string, string>
    readonly sandbox?: Layer.Layer<SandboxProvider.Service, unknown, HttpClient.HttpClient>
  } = {},
) =>
  ManagedRuntime.make(
    Host.serve(options.port ?? port, options.around).pipe(
      Layer.provideMerge(
        Host.stack({
          root,
          config: options.config ?? {},
          models,
          environments: Host.noTemplates,
          ...options,
          port: options.port ?? port,
        }),
      ),
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

const setKeepAlive = (brainId: Brain.ID, at: Date) =>
  database.runPromise(
    Effect.gen(function* () {
      const db = yield* Database.Service
      yield* db.db
        .update(Database.Schema.brain)
        .set({ keep_alive_until: at })
        .where(eq(Database.Schema.brain.id, brainId))
    }),
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
      yield* Seed.join(spaceId, creator.id)
      return { brainId, sessionId, spaceId, organizationId, creatorId: creator.id }
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
    await second.runPromise(Effect.void)
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
        provider.create({ brainId: Brain.ID.create(), generation: 1, env: {}, proxy: Option.none() }),
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

  test("an access after the app could not reach its brain asks the provider: a gone sandbox is replaced, a paused one wakes without a replace, a running one stays ready", async () => {
    const chats = await Promise.all([seeded(), seeded(), seeded()])
    await database.runPromise(
      Effect.gen(function* () {
        const db = yield* Database.Service
        yield* db.db
          .update(Database.Schema.agent_session)
          .set({ started_at: new Date() })
          .where(
            inArray(
              Database.Schema.agent_session.id,
              chats.map((chat) => chat.sessionId),
            ),
          )
      }),
    )
    const runtime = await ren({ lostEvery: "1 hour" })
    await runtime.runPromise(
      BrainLifecycle.Service.use((lifecycle) => Effect.forEach(chats, (chat) => lifecycle.ensure(chat.brainId))),
    )
    await Promise.all(chats.map((chat) => reaches(chat.brainId, "ready")))
    const gone = chats[0]
    const paused = chats[1]
    const running = chats[2]
    process.kill(-pidOf((await row(gone.brainId)).binding), "SIGKILL")
    await runtime.runPromise(
      SandboxProvider.Service.use((provider) =>
        Effect.gen(function* () {
          const binding = (yield* Effect.promise(() => row(paused.brainId))).binding
          yield* provider.keepAlive(binding, Duration.millis(1)).pipe(Effect.orDie)
          yield* provider
            .status(binding)
            .pipe(
              Effect.orDie,
              Effect.repeat({ until: (status) => status === "paused", schedule: Schedule.spaced("20 millis") }),
            )
        }),
      ),
    )
    const answers = await runtime.runPromise(
      Brains.Service.use((brains) =>
        Effect.forEach([gone, paused, running], (chat) =>
          brains.access(
            chat.sessionId,
            { userId: chat.creatorId, memberId: Auth.MemberID.create() },
            { unreachable: true },
          ),
        ),
      ),
    )
    expect(answers.map((answer) => (answer.status === "starting" ? answer.phase : answer.status))).toEqual([
      "replacing",
      "resuming",
      "ready",
    ])
    const woke = await reaches(paused.brainId, "ready")
    expect([woke.generation, (await row(running.brainId)).generation]).toEqual([1, 1])
    await runtime.dispose()
  })

  test("a push makes an awake brain pull without extending its keep-alive, leaves a paused one paused, and a down one costs at most 2 s (HR12)", async () => {
    const chats = await Promise.all([seeded(), seeded(), seeded()])
    const runtime = await ren({ lostEvery: "1 hour" })
    await runtime.runPromise(
      BrainLifecycle.Service.use((lifecycle) => Effect.forEach(chats, (chat) => lifecycle.ensure(chat.brainId))),
    )
    await Promise.all(chats.map((chat) => reaches(chat.brainId, "ready")))
    const awake = chats[0]
    const paused = chats[1]
    const down = chats[2]
    const pausedBinding = (await row(paused.brainId)).binding
    await runtime.runPromise(
      SandboxProvider.Service.use((provider) =>
        provider
          .keepAlive(pausedBinding, Duration.millis(1))
          .pipe(
            Effect.orDie,
            Effect.andThen(
              provider
                .status(pausedBinding)
                .pipe(
                  Effect.orDie,
                  Effect.repeat({ until: (status) => status === "paused", schedule: Schedule.spaced("20 millis") }),
                ),
            ),
          ),
      ),
    )
    await setKeepAlive(paused.brainId, new Date(Date.now() - 1000))
    process.kill(-pidOf((await row(down.brainId)).binding), "SIGSTOP")
    const pulledAt = (brainId: Brain.ID) =>
      Effect.promise(() => row(brainId)).pipe(
        Effect.flatMap((found) =>
          BrainClient.Service.use((client) =>
            client.brain({
              brainId,
              generation: found.generation,
              organizationId: found.organization_id,
              url: found.url ?? "",
              keyIds: found.key_ids,
              egress: found.egress,
            }),
          ),
        ),
        Effect.flatMap((client) => client.brain["brain.state"]()),
        Effect.map((state) => (state.pulledAt ? DateTime.toEpochMillis(state.pulledAt) : 0)),
        Effect.orDie,
      )
    const first = await runtime.runPromise(pulledAt(awake.brainId))
    const before = await row(awake.brainId)
    const started = Date.now()
    await runtime.runPromise(
      BrainHost.Service.use((host) =>
        Effect.forEach([awake, paused, down], (chat) => host.notify(chat.brainId), { concurrency: "unbounded" }),
      ),
    )
    expect(Date.now() - started).toBeLessThan(2500)
    await runtime.runPromise(
      pulledAt(awake.brainId).pipe(
        Effect.repeat({ until: (at) => at > first, schedule: Schedule.spaced("50 millis") }),
        Effect.timeout("5 seconds"),
      ),
    )
    expect((await row(awake.brainId)).keep_alive_until).toEqual(before.keep_alive_until)
    expect(
      await runtime.runPromise(SandboxProvider.Service.use((provider) => Effect.orDie(provider.status(pausedBinding)))),
    ).toBe("paused")
    process.kill(-pidOf((await row(down.brainId)).binding), "SIGCONT")
    await runtime.dispose()
  })

  test("Ren started at a new address tells each running brain, and the brain's next pull reaches it without a replace", async () => {
    const brainId = await newBrain()
    const first = await ren()
    await first.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(brainId)))
    await reaches(brainId, "ready")
    await first.dispose()
    const moved = await Effect.runPromise(Host.freePort)
    const pulled = Promise.withResolvers<void>()
    const second = await ren({
      port: moved,
      around: (endpoint, effect) =>
        endpoint === "pull" ? effect.pipe(Effect.ensuring(Effect.sync(() => pulled.resolve()))) : effect,
    })
    await second.runPromise(BrainLifecycle.Service.use(() => Effect.void))
    await pulled.promise
    expect((await row(brainId)).generation).toBe(1)
    await second.dispose()
  })

  test("a wake that is not confirmed in time leaves a brain that still answers ready, and does not replace it", async () => {
    const brainId = await newBrain()
    const first = await ren()
    await first.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(brainId)))
    await reaches(brainId, "ready")
    await first.dispose()
    await database.runPromise(
      Effect.gen(function* () {
        const db = yield* Database.Service
        yield* db.db
          .update(Database.Schema.brain)
          .set({ keep_alive_until: new Date(Date.now() - 1000) })
          .where(eq(Database.Schema.brain.id, brainId))
      }),
    )
    const stalled = await ren({
      config: { BRAIN_WAKE_TIMEOUT: "2 seconds" },
      around: (endpoint, effect) => (endpoint === "pull" ? Effect.never : effect),
    })
    await stalled.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.access(brainId)))
    await reaches(brainId, "waking")
    const ready = await reaches(brainId, "ready")
    expect(ready.generation).toBe(1)
    await stalled.dispose()
  })

  test("a booted brain that cannot reach Ren is not ready: it fails with a reason that names Ren, not ready forever", async () => {
    const brainId = await newBrain()
    const cut = await ren({
      config: { BRAIN_BOOT_TIMEOUT: "3 seconds" },
      around: (endpoint, effect) => (endpoint === "pull" ? Effect.never : effect),
    })
    await cut.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(brainId)))
    expect(await reaches(brainId, "failed")).toMatchObject({
      failures: 3,
      failure: expect.stringContaining("did not reach Ren"),
    })
    await cut.dispose()
  })

  test("a brain created behind an egress that this Ren no longer runs is replaced at its resume, not left without keys", async () => {
    const brainId = await newBrain()
    const current = await ren()
    await current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(brainId)))
    expect(await reaches(brainId, "ready")).toMatchObject({ generation: 1, egress: false })
    await database.runPromise(
      Effect.gen(function* () {
        const db = yield* Database.Service
        yield* db.db
          .update(Database.Schema.brain)
          .set({ egress: true, phase: "resuming" })
          .where(eq(Database.Schema.brain.id, brainId))
      }),
    )
    await current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(brainId)))
    const replaced = await Effect.runPromise(
      Effect.promise(() => row(brainId)).pipe(
        Effect.repeat({
          until: (found) => found.phase === "ready" && found.generation === 2,
          schedule: Schedule.spaced("100 millis"),
        }),
        Effect.timeout("60 seconds"),
      ),
    )
    expect(replaced).toMatchObject({ generation: 2, egress: false })
    await current.dispose()
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

// oxlint-disable-next-line ren/no-comments -- Live: calls E2B with the development key (README §7). script/test.ts removes E2B_ variables, so run it with `E2B_API_KEY=… bun test test/brain-lifecycle.test.ts -t E2B`.
describe.skipIf(!process.env.E2B_API_KEY)("an E2B brain", () => {
  test("E2B: a template tag that E2B does not have fails with the tag in the reason, and the third failure gives failed (G4, E81)", async () => {
    const found = await seeded()
    const current = await ren({
      sandbox: E2BSandbox.layer,
      config: { E2B_API_KEY: process.env.E2B_API_KEY ?? "", E2B_TEMPLATE: "ren-brain-dev:0000000000000000" },
    })
    await current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(found.brainId)))
    await reaches(found.brainId, "failed")
    expect(await row(found.brainId)).toMatchObject({
      failures: 3,
      failure: expect.stringContaining("tag '0000000000000000' does not exist"),
    })
    await current.dispose()
  })
})
