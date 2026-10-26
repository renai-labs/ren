import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Database } from "@ren/db/database"
import { inArray } from "drizzle-orm"
import { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import { Session } from "@ren/schema/session"
import { DateTime, Duration, Effect, Option, Schedule, type Schema } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Brains } from "../src/brains.js"
import { BrainClient } from "../src/brain-client.js"
import { BrainHost } from "../src/brain-host.js"
import { BrainLifecycle } from "../src/brain-lifecycle.js"
import { SandboxProvider } from "../src/sandbox-provider.js"
import { BrainRuns } from "./lib/brain-runs.js"
import { ChannelFixture } from "./lib/channel-fixture.js"
import { Host } from "./lib/host.js"

setDefaultTimeout(120_000)

const runs = await BrainRuns.make()

const pause = (binding: Schema.Json) =>
  SandboxProvider.Service.use((provider) =>
    provider
      .keepAlive(binding, Duration.millis(1))
      .pipe(
        Effect.orDie,
        Effect.andThen(
          provider
            .status(binding)
            .pipe(
              Effect.orDie,
              Effect.repeat({ until: (status) => status === "paused", schedule: Schedule.spaced("20 millis") }),
            ),
        ),
      ),
  )

beforeAll(() => runs.setup())

afterAll(() => runs.dispose())

describe("brain runs", () => {
  test("a run that Ren stopped while the brain booted continues after Ren starts again, on the same sandbox", async () => {
    const brainId = await runs.newBrain()
    const first = await runs.ren({ keepBrains: true })
    await first.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(brainId)))
    const booting = await runs.reaches(brainId, "booting")
    await first.dispose()
    const second = await runs.ren()
    await second.runPromise(Effect.void)
    const ready = await runs.reaches(brainId, "ready")
    expect(ready.binding).toEqual(booting.binding)
    const sandboxes = await second.runPromise(SandboxProvider.Service.use((provider) => provider.list))
    expect(sandboxes.filter((each) => each.brainId === brainId)).toHaveLength(1)
    await second.dispose()
  })

  test("a sandbox that is gone marks its brain's busy chats interrupted and the brain replacing, with no access", async () => {
    const found = await runs.seeded()
    const current = await runs.ren({ lostEvery: "50 millis" })
    await current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(found.brainId)))
    const ready = await runs.reaches(found.brainId, "ready")
    await runs.busy(found.sessionId)
    process.kill(-BrainRuns.pidOf(ready.binding), "SIGKILL")
    await runs.reaches(found.brainId, "replacing")
    expect(await runs.outcome(found.sessionId)).toBe("interrupted")
    await current.dispose()
  })

  test("a call that finds its brain's sandbox gone marks the brain replacing, for providers without lost events", async () => {
    const found = await runs.seeded()
    const current = await runs.ren({ lostEvery: "1 hour" })
    await current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(found.brainId)))
    const ready = await runs.reaches(found.brainId, "ready")
    process.kill(-BrainRuns.pidOf(ready.binding), "SIGKILL")
    const failed = await current.runPromise(
      Brains.Service.use((host) =>
        host.send({
          sessionId: found.sessionId,
          messageId: Session.MessageID.create(),
          prompt: { text: "hello" },
          delivery: "steer",
          sender: { userId: "user_1" },
        }),
      ).pipe(Effect.flip, ChannelFixture.quickly),
    )
    expect(failed._tag).toBe("BrainUnavailable")
    expect((await runs.row(found.brainId)).phase).toBe("replacing")
    await current.dispose()
  })

  test("cleanup destroys the sandbox of a brain with all chats archived or its space archived, and keeps the others", async () => {
    const current = await runs.ren()
    const brains = await Promise.all([runs.seeded(), runs.seeded(), runs.seeded()])
    await Promise.all(
      brains.map((found) =>
        current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(found.brainId))),
      ),
    )
    const pids = await Promise.all(
      brains.map((found) => runs.reaches(found.brainId, "ready").then((ready) => BrainRuns.pidOf(ready.binding))),
    )
    const archivedChats = brains[0]
    const archivedSpace = brains[1]
    await runs.archive("session", archivedChats)
    await runs.archive("space", archivedSpace)
    await current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.cleanup))
    expect(pids.map(BrainRuns.isAlive)).toEqual([false, false, true])
    expect((await runs.row(archivedChats.brainId)).binding).toBeNull()
    expect((await runs.row(archivedSpace.brainId)).binding).toBeNull()
    await current.dispose()
  })

  test("a start for a failed brain gives up, and Retry with the first message starts the chat", async () => {
    const found = await runs.seeded()
    const current = await runs.ren()
    await runs.update(found.brainId, {
      phase: "failed",
      failures: 3,
      failure: "the template is broken",
      run_epoch: 1,
    })
    const script = BrainRuns.stub.script({ reply: "started" })
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

  test("a brain waits for capacity without counting a failure, and starts once a sandbox stops", async () => {
    const first = await runs.seeded()
    const second = await runs.seeded()
    const own = await mkdtemp(join(tmpdir(), "ren-core-brains-"))
    const current = await runs.ren({ maxRunning: 1, root: own })
    const lifecycle = (use: (lifecycle: BrainLifecycle.Interface) => Effect.Effect<unknown, unknown>) =>
      current.runPromise(BrainLifecycle.Service.use(use))
    await lifecycle((each) => each.ensure(first.brainId))
    const running = await runs.reaches(first.brainId, "ready")
    const waiting = await lifecycle((each) =>
      each.access(second.brainId).pipe(
        Effect.repeat({
          until: (access) => access._tag === "Starting" && access.phase === "waiting for capacity",
          schedule: Schedule.spaced("50 millis"),
        }),
        Effect.timeout("20 seconds"),
      ),
    )
    expect(waiting).toEqual({ _tag: "Starting", phase: "waiting for capacity" })
    expect((await runs.row(second.brainId)).failures).toBe(0)
    process.kill(-BrainRuns.pidOf(running.binding), "SIGKILL")
    await runs.reaches(second.brainId, "ready")
    await current.dispose()
    await rm(own, { recursive: true, force: true })
  })

  test("a paused brain on an older build is replaced with the provider's build at its next access; a running one keeps its build", async () => {
    const paused = await runs.newBrain()
    const running = await runs.newBrain()
    const runtime = await runs.ren({ template: "t2" })
    await runtime.runPromise(
      BrainLifecycle.Service.use((lifecycle) =>
        Effect.all([lifecycle.ensure(paused), lifecycle.ensure(running)], { discard: true }),
      ),
    )
    await Promise.all([runs.reaches(paused, "ready"), runs.reaches(running, "ready")])
    await runs.update(paused, { template: "t1", keep_alive_until: new Date(Date.now() - 1000) })
    await runs.update(running, { template: "t1" })
    await runtime.runPromise(
      BrainLifecycle.Service.use((lifecycle) =>
        Effect.all([lifecycle.access(paused), lifecycle.access(running)], { discard: true }),
      ),
    )
    const replaced = await Effect.runPromise(
      Effect.promise(() => runs.row(paused)).pipe(
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
    expect([replaced.template, (await runs.row(running)).generation, (await runs.row(running)).template]).toEqual([
      "t2",
      1,
      "t1",
    ])
    await runtime.dispose()
  })

  test("an access after the app could not reach its brain asks the provider: a gone sandbox is replaced, a paused one wakes without a replace, a running one stays ready", async () => {
    const chats = await Promise.all([runs.seeded(), runs.seeded(), runs.seeded()])
    await runs.database.runPromise(
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
    const runtime = await runs.ren({ lostEvery: "1 hour" })
    await runtime.runPromise(
      BrainLifecycle.Service.use((lifecycle) => Effect.forEach(chats, (chat) => lifecycle.ensure(chat.brainId))),
    )
    await Promise.all(chats.map((chat) => runs.reaches(chat.brainId, "ready")))
    const gone = chats[0]
    const asleep = chats[1]
    const running = chats[2]
    process.kill(-BrainRuns.pidOf((await runs.row(gone.brainId)).binding), "SIGKILL")
    await runtime.runPromise(pause((await runs.row(asleep.brainId)).binding))
    const answers = await runtime.runPromise(
      Brains.Service.use((brains) =>
        Effect.forEach([gone, asleep, running], (chat) =>
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
    const woke = await runs.reaches(asleep.brainId, "ready")
    expect([woke.generation, (await runs.row(running.brainId)).generation]).toEqual([1, 1])
    await runtime.dispose()
  })

  test("a push makes an awake brain pull without extending its keep-alive, leaves a paused one paused, and a down one costs at most 2 s (HR12)", async () => {
    const chats = await Promise.all([runs.seeded(), runs.seeded(), runs.seeded()])
    const runtime = await runs.ren({ lostEvery: "1 hour" })
    await runtime.runPromise(
      BrainLifecycle.Service.use((lifecycle) => Effect.forEach(chats, (chat) => lifecycle.ensure(chat.brainId))),
    )
    await Promise.all(chats.map((chat) => runs.reaches(chat.brainId, "ready")))
    const awake = chats[0]
    const asleep = chats[1]
    const down = chats[2]
    const pausedBinding = (await runs.row(asleep.brainId)).binding
    await runtime.runPromise(pause(pausedBinding))
    await runs.update(asleep.brainId, { keep_alive_until: new Date(Date.now() - 1000) })
    process.kill(-BrainRuns.pidOf((await runs.row(down.brainId)).binding), "SIGSTOP")
    const pulledAt = (brainId: Brain.ID) =>
      Effect.promise(() => runs.row(brainId)).pipe(
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
    const before = await runs.row(awake.brainId)
    const started = Date.now()
    await runtime.runPromise(
      BrainHost.Service.use((host) =>
        Effect.forEach([awake, asleep, down], (chat) => host.notify(chat.brainId), { concurrency: "unbounded" }),
      ),
    )
    expect(Date.now() - started).toBeLessThan(2500)
    await runtime.runPromise(
      pulledAt(awake.brainId).pipe(
        Effect.repeat({ until: (at) => at > first, schedule: Schedule.spaced("50 millis") }),
        Effect.timeout("5 seconds"),
      ),
    )
    expect((await runs.row(awake.brainId)).keep_alive_until).toEqual(before.keep_alive_until)
    expect(
      await runtime.runPromise(SandboxProvider.Service.use((provider) => Effect.orDie(provider.status(pausedBinding)))),
    ).toBe("paused")
    await runtime.dispose()
  })

  test("Ren started at a new address tells each running brain, and the brain's next pull reaches it without a replace", async () => {
    const brainId = await runs.newBrain()
    const first = await runs.ren({ keepBrains: true })
    await first.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(brainId)))
    await runs.reaches(brainId, "ready")
    await first.dispose()
    const moved = await Effect.runPromise(Host.freePort)
    const pulled = Promise.withResolvers<void>()
    const second = await runs.ren({
      port: moved,
      around: (endpoint, effect) =>
        endpoint === "pull" ? effect.pipe(Effect.ensuring(Effect.sync(() => pulled.resolve()))) : effect,
    })
    await second.runPromise(BrainLifecycle.Service.use(() => Effect.void))
    await pulled.promise
    expect((await runs.row(brainId)).generation).toBe(1)
    await second.dispose()
  })

  test("a wake that is not confirmed in time leaves a brain that still answers ready, and does not replace it", async () => {
    const brainId = await runs.newBrain()
    const first = await runs.ren({ keepBrains: true })
    await first.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(brainId)))
    await runs.reaches(brainId, "ready")
    await first.dispose()
    await runs.update(brainId, { keep_alive_until: new Date(Date.now() - 1000) })
    const stalled = await runs.ren({
      config: { BRAIN_WAKE_TIMEOUT: "2 seconds" },
      around: (endpoint, effect) => (endpoint === "pull" ? Effect.never : effect),
    })
    await stalled.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.access(brainId)))
    await runs.reaches(brainId, "waking")
    const ready = await runs.reaches(brainId, "ready")
    expect(ready.generation).toBe(1)
    await stalled.dispose()
  })

  test("a booted brain that cannot reach Ren is not ready: it fails with a reason that names Ren, not ready forever", async () => {
    const brainId = await runs.newBrain()
    const cut = await runs.ren({
      config: { BRAIN_BOOT_TIMEOUT: "3 seconds" },
      around: (endpoint, effect) => (endpoint === "pull" ? Effect.never : effect),
    })
    await cut.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(brainId)))
    expect(await runs.reaches(brainId, "failed")).toMatchObject({
      failures: 3,
      failure: expect.stringContaining("did not reach Ren"),
    })
    await cut.dispose()
  })

  test("a brain created behind an egress that this Ren no longer runs is replaced at its resume, not left without keys", async () => {
    const brainId = await runs.newBrain()
    const current = await runs.ren()
    await current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(brainId)))
    expect(await runs.reaches(brainId, "ready")).toMatchObject({ generation: 1, egress: false })
    await runs.update(brainId, { egress: true, phase: "resuming" })
    await current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(brainId)))
    const replaced = await Effect.runPromise(
      Effect.promise(() => runs.row(brainId)).pipe(
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
    const brainId = await runs.newBrain()
    const current = await runs.ren()
    await current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(brainId)))
    await runs.reaches(brainId, "ready")
    await runs.update(brainId, { phase: "resuming" })
    await current.runPromise(BrainLifecycle.Service.use((lifecycle) => lifecycle.ensure(brainId)))
    await runs.reaches(brainId, "ready")
    await current.dispose()
  })
})
