import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Machine, Processes } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Effect, ManagedRuntime } from "effect"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Pid } from "./lib/pid.js"
import { FakeRen } from "./lib/ren.js"
import { Shared } from "./lib/shared.js"
import type { StubModel } from "./lib/stub-model.js"
import { TestCell } from "./lib/test-cell.js"
import { Wrangler } from "./lib/wrangler.js"

setDefaultTimeout(120_000)

const stub = Shared.stub()
const fileTools = new Set(["read", "write", "edit", "glob", "grep", "shell"])
const environmentId = Environment.ID.create()

const sandbox = async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "ren-lifecycle-")))
  const runtime = ManagedRuntime.make(Machine.layer({ environmentId, workspace: directory }))
  return { directory, url: await runtime.runPromise(Machine.url), dispose: () => runtime.dispose() }
}

type Sandbox = Awaited<ReturnType<typeof sandbox>>

const shell = (command: string) => ({ tool: { name: "shell", input: { command } } })

const lastToolResult = (call: StubModel.Call) =>
  JSON.stringify(call.body.messages.findLast((message) => message.role === "tool")?.content ?? "")

let first: Sandbox
let replacement: Sandbox
let cell: Wrangler.Instance
let ren: FakeRen.Instance
let withRen: Record<string, string>
let withoutRen: Record<string, string>

const place = async (
  sessionId: Session.ID,
  target: Sandbox,
  options: { readonly lifetimeMs?: number; readonly generation?: number } = {},
) => {
  const lifetimeMs = options.lifetimeMs ?? 3_600_000
  const sign = () =>
    Effect.runPromise(
      Machine.access({
        url: target.url,
        environmentId,
        brain: Brain.ofSession(sessionId),
        directory: join(target.directory, sessionId),
        lifetimeMs,
        generation: options.generation ?? 1,
      }),
    )
  ren.answer(sessionId, async () => ({ type: "access", access: await sign() }))
}

const connect = async () => {
  const opened = await TestCell.make(cell.url)
  const sessionId = Session.ID.make(opened.id)
  const configure = async () =>
    expect((await opened.models(Shared.access(), await FakeRen.hostToken(sessionId))).status).toBe(204)
  const start = (onEnvironment: boolean) =>
    opened.brain("/ren/sessions", {
      sessionId,
      harness: "opencode",
      interactive: false,
      ...(onEnvironment && { environment: { environmentId, directory: Environment.sessionDirectory(sessionId) } }),
    })
  const send = async (script: StubModel.Script) => {
    const sent = await opened.brain(`/ren/sessions/${sessionId}/messages`, {
      messageId: Session.MessageID.create(),
      prompt: { text: `${script.marker} use the tool` },
      sender: { userId: "user_1" },
    })
    expect(sent.status).toBe(200)
  }
  return {
    opened,
    sessionId,
    configure,
    start,
    send,
    turn: async (script: StubModel.Script, calls = 2) => {
      await send(script)
      return script.called(calls)
    },
  }
}

const begin = async (onEnvironment = true, target: Sandbox = first) => {
  const session = await connect()
  if (onEnvironment) await place(session.sessionId, target)
  await session.configure()
  expect((await session.start(onEnvironment)).status).toBe(200)
  return session
}

const pwdOf = async (session: Awaited<ReturnType<typeof begin>>) =>
  lastToolResult(await session.turn(stub.script(shell("pwd"))))

describe.skipIf(process.env.CELL_RUNTIME !== "wrangler")("environments across a cell's lifecycle", () => {
  beforeAll(async () => {
    ren = FakeRen.start()
    first = await sandbox()
    replacement = await sandbox()
    withoutRen = Shared.vars(stub.url)
    withRen = { ...withoutRen, REN_URL: ren.url }
    cell = await Wrangler.make(withRen)
  }, 180_000)

  afterAll(async () => {
    await cell.dispose()
    await Promise.all([first, replacement].map((each) => each.dispose()))
    await ren.stop()
  })

  test("the production worker asks Ren for the sandbox at the first tool call, not at start", async () => {
    const session = await begin()
    await session.turn(stub.script(), 1)
    expect(ren.accessCalls(session.sessionId)).toBe(0)
    expect(await pwdOf(session)).toContain(join(first.directory, session.sessionId))
    expect(ren.accessCalls(session.sessionId)).toBe(1)
  })

  test("after the cell sleeps and wakes, a session's tools run on its sandbox, and one without has none", async () => {
    const onSandbox = await begin()
    const local = await begin(false)
    expect(await pwdOf(onSandbox)).toContain(join(first.directory, onSandbox.sessionId))
    await Promise.all(
      [onSandbox, local].map((session) => session.opened.until((state) => Bun.deepEquals(state, TestCell.closed), 30_000)),
    )
    expect(await pwdOf(onSandbox)).toContain(join(first.directory, onSandbox.sessionId))
    const call = await local.turn(stub.script(), 1)
    expect(call.tools.filter((tool) => fileTools.has(tool))).toEqual([])
  })

  test("workerd holds a tool's output stream open while a command runs for 20 seconds", async () => {
    const session = await begin()
    const started = Date.now()
    expect(lastToolResult(await session.turn(stub.script(shell("sleep 20 && echo late"))))).toContain("late")
    expect(Date.now() - started).toBeGreaterThanOrEqual(20_000)
  })

  test("after the cell is killed and restarted, the next tool call asks Ren again and reaches the same folder", async () => {
    const session = await begin()
    expect(await pwdOf(session)).toContain(join(first.directory, session.sessionId))
    await cell.crash()
    await cell.start()
    expect(await pwdOf(session)).toContain(join(first.directory, session.sessionId))
    expect(ren.accessCalls(session.sessionId)).toBe(2)
  })

  test("a cell killed while it creates a session on a sandbox ends with one session where a retried start puts it", async () => {
    const delays = [0, 15, 40, 80, 150, 300]
    const outcomes = await delays.reduce<Promise<ReadonlyArray<string>>>(async (previous, delay) => {
      const done = await previous
      const session = await connect()
      await place(session.sessionId, first)
      await session.configure()
      const starting = session.start(true).catch(() => undefined)
      // ast-grep-ignore: no-test-sleep -- the crash must land at each point of the start
      await Bun.sleep(delay)
      await cell.crash()
      await starting
      await cell.start()
      await session.configure()
      const retried = await session.start(true)
      const pwd = await pwdOf(session)
      return [...done, `${delay}ms:${retried.status}:${pwd.includes(session.sessionId) ? "sandbox" : pwd}`]
    }, Promise.resolve([]))
    expect(outcomes).toEqual(delays.map((delay) => `${delay}ms:200:sandbox`))
  }, 300_000)

  test("a sandbox replaced while the cell is down is the one the next command reaches", async () => {
    const original = await sandbox()
    const session = await begin(true, original)
    expect(await pwdOf(session)).toContain(original.directory)
    await cell.crash()
    await original.dispose()
    await place(session.sessionId, replacement, { generation: 2 })
    await cell.start()
    expect(await pwdOf(session)).toContain(join(replacement.directory, session.sessionId))
  })

  test("a sandbox replaced while the cell runs fails one call, and the next asks Ren and reaches the new one", async () => {
    const original = await sandbox()
    const session = await begin(true, original)
    expect(await pwdOf(session)).toContain(original.directory)
    await original.dispose()
    await place(session.sessionId, replacement, { generation: 2 })
    expect(await pwdOf(session)).toContain("does not answer")
    expect(await pwdOf(session)).toContain(join(replacement.directory, session.sessionId))
  })

  test("killing the cell mid-command stops the command on the sandbox, and the session works after the restart", async () => {
    const session = await begin()
    const pidFile = join(first.directory, `${crypto.randomUUID()}.pid`)
    const running = stub.script(shell(`echo $$ > ${pidFile}; exec sleep 120`))
    await session.send(running)
    const pid = await Effect.runPromise(Pid.read(pidFile))
    await cell.crash()
    const killedAt = await waitUntil(() => !Processes.running(pid), 60_000)
    if (killedAt === undefined) process.kill(pid, "SIGKILL")
    running.set({ reply: "stopped" })
    await cell.start()
    expect(await pwdOf(session)).toContain(join(first.directory, session.sessionId))
    expect(killedAt).toBeLessThan(45_000)
  }, 180_000)

  test("an environment token that expires while the cell sleeps is renewed at the next tool call", async () => {
    const session = await connect()
    await place(session.sessionId, first, { lifetimeMs: 20_000 })
    await session.configure()
    expect((await session.start(true)).status).toBe(200)
    expect(await pwdOf(session)).toContain(session.sessionId)
    await session.opened.until((state) => Bun.deepEquals(state, TestCell.closed), 30_000)
    // ast-grep-ignore: no-test-sleep -- the real environment token must expire while the cell sleeps
    await Bun.sleep(21_000)
    expect(await pwdOf(session)).toContain(join(first.directory, session.sessionId))
    expect(ren.accessCalls(session.sessionId)).toBeGreaterThanOrEqual(2)
  }, 120_000)

  test("Ren down when the cell wakes with an expired token gives Ren does not answer, and works once Ren is back", async () => {
    const session = await connect()
    await place(session.sessionId, first, { lifetimeMs: 20_000 })
    await session.configure()
    expect((await session.start(true)).status).toBe(200)
    expect(await pwdOf(session)).toContain(session.sessionId)
    await cell.crash()
    // ast-grep-ignore: no-test-sleep -- the real environment token must expire while the cell is down
    await Bun.sleep(21_000)
    ren.answer(session.sessionId, () => ({ type: "unavailable", message: "Ren is restarting" }))
    await cell.start()
    expect(await pwdOf(session)).toContain("Ren does not answer")
    expect(ren.accessCalls(session.sessionId)).toBe(2)
    await place(session.sessionId, first)
    await cell.crash()
    await cell.start()
    expect(await pwdOf(session)).toContain(join(first.directory, session.sessionId))
    expect(ren.accessCalls(session.sessionId)).toBe(3)
  }, 180_000)

  test("a cell without Ren keeps a sandbox session's conversation without its tools, and Ren back restores them", async () => {
    const session = await begin()
    expect(await pwdOf(session)).toContain(first.directory)
    await cell.restart(withoutRen)
    const without = stub.script(shell("pwd"))
    // ast-grep-ignore: no-test-sleep -- a turn without tools must answer within a deadline, not hang
    const answered = await Promise.race([session.turn(without, 1), Bun.sleep(30_000).then(() => undefined)])
    expect(answered?.tools.filter((tool) => fileTools.has(tool))).toEqual([])
    expect(JSON.stringify(answered?.body.messages)).toContain(first.directory)
    without.set({ reply: "no tools" })
    await cell.restart(withRen)
    expect(await pwdOf(session)).toContain(join(first.directory, session.sessionId))
  })

  test("a session started without an environment cannot get one later, and a new session can", async () => {
    const old = await begin(false)
    await old.turn(stub.script(), 1)
    await place(old.sessionId, first)
    const refused = await old.start(true)
    expect(refused.status).not.toBe(200)
    expect(await refused.text()).toContain("not supported yet")
    const fresh = await begin()
    expect(await pwdOf(fresh)).toContain(join(first.directory, fresh.sessionId))
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
