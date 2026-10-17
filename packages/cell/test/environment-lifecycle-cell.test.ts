import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Machine, Processes } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Effect, ManagedRuntime, Schema } from "effect"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Pid } from "./lib/pid.js"
import { Shared } from "./lib/shared.js"
import type { StubModel } from "./lib/stub-model.js"
import { TestCell } from "./lib/test-cell.js"
import { Wrangler } from "./lib/wrangler.js"

setDefaultTimeout(120_000)

const brain = Brain.ID.create()
const stub = Shared.stub()
const fileTools = new Set(["read", "write", "edit", "glob", "grep", "shell"])
const environmentWorker = "test/lib/environment-worker.ts"
const productionWorker = "src/worker.ts"

const machine = async (environmentId: Environment.ID) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "ren-lifecycle-")))
  const runtime = ManagedRuntime.make(Machine.layer({ environmentId, workspace: directory }))
  return { environmentId, directory, url: await runtime.runPromise(Machine.url), dispose: () => runtime.dispose() }
}

type Target = Awaited<ReturnType<typeof machine>>

const varsFor = async (accesses: ReadonlyArray<{ readonly target: Target; readonly generation?: number }>) => ({
  ...Shared.vars(stub.url),
  TEST_ENVIRONMENT_ACCESS: Schema.encodeSync(
    Schema.fromJsonString(Schema.toCodecJson(Schema.Array(Environment.Access))),
  )(
    await Promise.all(
      accesses.map((entry) =>
        Effect.runPromise(
          Machine.access({
            url: entry.target.url,
            environmentId: entry.target.environmentId,
            brain,
            lifetimeMs: 3_600_000,
            generation: entry.generation ?? 1,
          }),
        ),
      ),
    ),
  ),
})

const shell = (command: string) => ({ tool: { name: "shell", input: { command } } })

const lastToolResult = (call: StubModel.Call) =>
  JSON.stringify(call.body.messages.findLast((message) => message.role === "tool")?.content ?? "")

const where = (target: Target) => ({ environmentId: target.environmentId, directory: target.directory })

let first: Target
let second: Target
let replacement: Target
let cell: Wrangler.Instance
let standard: Record<string, string>

const connect = async () => {
  const opened = await TestCell.make(cell.url)
  const start = (environments?: ReadonlyArray<Environment.Location>) =>
    opened.brain("/ren/sessions", {
      sessionId: opened.id,
      harness: "opencode",
      interactive: false,
      ...(environments && { environments }),
    })
  const send = async (script: StubModel.Script) => {
    const sent = await opened.brain(`/ren/sessions/${opened.id}/messages`, {
      messageId: Session.MessageID.create(),
      prompt: { text: `${script.marker} use the tool` },
      sender: { userId: "user_1" },
    })
    expect(sent.status).toBe(200)
  }
  return {
    opened,
    start,
    send,
    turn: async (script: StubModel.Script, calls = 2) => {
      await send(script)
      return script.called(calls)
    },
  }
}

const begin = async (environments: ReadonlyArray<Environment.Location>) => {
  const session = await connect()
  expect((await session.opened.models()).status).toBe(204)
  expect((await session.start(environments)).status).toBe(200)
  return session
}

const pwdOf = async (session: Awaited<ReturnType<typeof begin>>) =>
  lastToolResult(await session.turn(stub.script(shell("pwd"))))

describe.skipIf(process.env.CELL_RUNTIME !== "wrangler")("environments across a cell's lifecycle", () => {
  beforeAll(async () => {
    const firstId = Environment.ID.create()
    first = await machine(firstId)
    second = await machine(Environment.ID.create())
    replacement = await machine(firstId)
    standard = await varsFor([{ target: first }, { target: second }])
    cell = await Wrangler.make(standard, environmentWorker)
  }, 180_000)

  afterAll(async () => {
    await cell.dispose()
    await Promise.all([first, second, replacement].map((each) => each.dispose()))
  })

  const placed = async () => {
    const onFirst = await begin([where(first)])
    const moved = await begin([where(first)])
    expect((await moved.start([where(second)])).status).toBe(200)
    const local = await begin([])
    return { onFirst, moved, local }
  }

  const expectPlaced = async (sessions: Awaited<ReturnType<typeof placed>>) => {
    expect(await pwdOf(sessions.onFirst)).toContain(first.directory)
    expect(await pwdOf(sessions.moved)).toContain(second.directory)
    const local = await sessions.local.turn(stub.script(), 1)
    expect(local.tools.filter((tool) => fileTools.has(tool))).toEqual([])
  }

  test("after the cell sleeps and wakes, every session's tools are where its last start put them", async () => {
    const sessions = await placed()
    await Promise.all(
      Object.values(sessions).map((session) =>
        session.opened.until((state) => Bun.deepEquals(state, TestCell.closed), 30_000),
      ),
    )
    await expectPlaced(sessions)
  })

  test("workerd holds a tool's output stream open while a command runs for 20 seconds", async () => {
    const session = await begin([where(first)])
    const started = Date.now()
    expect(lastToolResult(await session.turn(stub.script(shell("sleep 20 && echo late"))))).toContain("late")
    expect(Date.now() - started).toBeGreaterThanOrEqual(20_000)
  })

  test("after the cell is killed and restarted, every session's tools are where its last start put them", async () => {
    const sessions = await placed()
    await cell.crash()
    await cell.start()
    await expectPlaced(sessions)
  })

  test("a cell killed at any point of a move ends where a retried start puts it", async () => {
    const delays = [0, 15, 40, 80, 150, 300]
    const outcomes = await delays.reduce<Promise<ReadonlyArray<string>>>(async (previous, delay) => {
      const done = await previous
      const session = await begin([where(first)])
      const moving = session.start([where(second)]).catch(() => undefined)
      // ast-grep-ignore: no-test-sleep -- the crash must land at each point of the start
      await Bun.sleep(delay)
      await cell.crash()
      await moving
      await cell.start()
      const retried = await session.start([where(second)])
      const pwd = await pwdOf(session)
      return [...done, `${delay}ms:${retried.status}:${pwd.includes(second.directory) ? "second" : pwd}`]
    }, Promise.resolve([]))
    expect(outcomes).toEqual(delays.map((delay) => `${delay}ms:200:second`))
  }, 300_000)

  test("a cell killed while it creates a session on a machine ends where a retried start puts it", async () => {
    const delays = [0, 15, 40, 80, 150, 300]
    const outcomes = await delays.reduce<Promise<ReadonlyArray<string>>>(async (previous, delay) => {
      const done = await previous
      const session = await connect()
      expect((await session.opened.models()).status).toBe(204)
      const starting = session.start([where(first)]).catch(() => undefined)
      // ast-grep-ignore: no-test-sleep -- the crash must land at each point of the start
      await Bun.sleep(delay)
      await cell.crash()
      await starting
      await cell.start()
      expect((await session.opened.models()).status).toBe(204)
      const retried = await session.start([where(first)])
      const pwd = await pwdOf(session)
      return [...done, `${delay}ms:${retried.status}:${pwd.includes(first.directory) ? "first" : pwd}`]
    }, Promise.resolve([]))
    expect(outcomes).toEqual(delays.map((delay) => `${delay}ms:200:first`))
  }, 300_000)

  test("a machine replaced while the cell is down is the one the next command reaches", async () => {
    const original = await machine(replacement.environmentId)
    await cell.restart(await varsFor([{ target: first }, { target: original }]))
    const session = await begin([where(original)])
    expect(await pwdOf(session)).toContain(original.directory)
    await cell.crash()
    await original.dispose()
    await cell.restart(await varsFor([{ target: first }, { target: replacement, generation: 2 }]))
    const marker = `${crypto.randomUUID()}.txt`
    const reached = lastToolResult(await session.turn(stub.script(shell(`echo replaced > ${marker} && echo reached`))))
    expect(reached).toContain("reached")
    await cell.restart(standard)
  })

  test("killing the cell mid-command stops the command on the machine, and the session works after the restart", async () => {
    const session = await begin([where(first)])
    const pidFile = join(first.directory, `${crypto.randomUUID()}.pid`)
    const running = stub.script(shell(`echo $$ > ${pidFile}; exec sleep 120`))
    await session.send(running)
    const pid = await Effect.runPromise(Pid.read(pidFile))
    await cell.crash()
    const killedAt = await waitUntil(() => !Processes.running(pid), 60_000)
    if (killedAt === undefined) process.kill(pid, "SIGKILL")
    running.set({ reply: "stopped" })
    await cell.start()
    expect(await pwdOf(session)).toContain(first.directory)
    expect(killedAt).toBeLessThan(45_000)
  }, 180_000)

  test("a cell without machine support keeps a bound session's conversation, and support coming back restores its tools", async () => {
    const session = await begin([where(first)])
    expect(await pwdOf(session)).toContain(first.directory)
    await cell.restart(standard, productionWorker)
    const without = stub.script(shell("pwd"))
    // ast-grep-ignore: no-test-sleep -- a turn without tools must answer within a deadline, not hang
    const answered = await Promise.race([session.turn(without, 1), Bun.sleep(30_000).then(() => undefined)])
    expect(answered).toBeDefined()
    expect(answered?.tools.filter((tool) => fileTools.has(tool))).toEqual([])
    expect(JSON.stringify(answered?.body.messages)).toContain(first.directory)
    without.set({ reply: "no tools" })
    await cell.restart(standard, environmentWorker)
    expect(await pwdOf(session)).toContain(first.directory)
  })

  test("a session started without machine support cannot attach one later, and a new session can", async () => {
    await cell.restart(standard, productionWorker)
    const old = await begin([])
    await old.turn(stub.script(), 1)
    await cell.restart(standard, environmentWorker)
    const refused = await old.start([where(first)])
    expect(refused.status).not.toBe(200)
    expect(await refused.text()).toContain("cannot attach")
    const fresh = await begin([where(first)])
    expect(await pwdOf(fresh)).toContain(first.directory)
  })
})

const waitUntil = async (
  condition: () => boolean,
  timeout: number,
  started = Date.now(),
): Promise<number | undefined> => {
  if (condition()) return Date.now() - started
  if (Date.now() - started > timeout) return undefined
  // ast-grep-ignore: no-test-sleep -- polls the real worker's process list
  await Bun.sleep(250)
  return waitUntil(condition, timeout, started)
}
