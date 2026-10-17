import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Machine, Processes, Relay } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Effect, Exit, ManagedRuntime, Scope } from "effect"
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

// oxlint-disable-next-line ren/no-comments -- A sandbox behind a relay keeps its URL when its executor restarts, as a resumed sandbox does.
const restartable = async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "ren-lifecycle-restart-")))
  const state = { runtime: ManagedRuntime.make(Machine.layer({ environmentId, workspace: directory })) }
  const scope = Effect.runSync(Scope.make())
  const relay = await Effect.runPromise(
    Relay.make(Relay.portOf(await state.runtime.runPromise(Machine.url))).pipe(Scope.provide(scope)),
  )
  return {
    directory,
    url: relay.url,
    restart: async () => {
      await state.runtime.dispose()
      state.runtime = ManagedRuntime.make(Machine.layer({ environmentId, workspace: directory }))
      await Effect.runPromise(relay.target(Relay.portOf(await state.runtime.runPromise(Machine.url))))
      await Effect.runPromise(relay.cut)
    },
    dispose: async () => {
      await Effect.runPromise(Scope.close(scope, Exit.void))
      await state.runtime.dispose()
    },
  }
}

const signalCell = (instance: Wrangler.Instance, signal: "STOP" | "CONT") => {
  const descendants = (pid: number): ReadonlyArray<number> => {
    const children = new TextDecoder()
      .decode(Bun.spawnSync(["pgrep", "-P", String(pid)]).stdout)
      .split("\n")
      .filter(Boolean)
      .map(Number)
    return [...children, ...children.flatMap(descendants)]
  }
  const root = instance.pid()
  if (root) for (const pid of [root, ...descendants(root)]) Bun.spawnSync(["kill", `-${signal}`, String(pid)])
}

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

  test("the full output of a long command, in the foreground or the background, is on the sandbox at the path OpenCode names", async () => {
    const session = await begin()
    const savedTo = (result: string) =>
      result.match(/(?:full output saved to|Output is streaming to:) ([^\]\\"]+)/)?.[1] ?? ""
    const foreground = savedTo(lastToolResult(await session.turn(stub.script(shell("seq 1 30000")))))
    expect(foreground).toStartWith("/tmp/opencode/data/shell/")
    expect(await pwdOf(session)).toContain(session.sessionId)
    expect(
      lastToolResult(await session.turn(stub.script(shell(`tail -n 1 ${foreground}; grep -c . ${foreground}`)))),
    ).toContain("30000\\n30000")
    const read = stub.script({ tool: { name: "read", input: { path: foreground, offset: 15000, limit: 1 } } })
    expect(lastToolResult(await session.turn(read))).toContain("15000")
    const job = stub.script({ tool: { name: "shell", input: { command: "seq 1 30000; sleep 1", background: true } } })
    const background = savedTo(lastToolResult(await session.turn(job)))
    expect(background).toStartWith("/tmp/opencode/data/shell/")
    // oxlint-disable-next-line ren/no-comments -- An idle cell parks after 2 seconds here and cancels its background jobs, so a foreground command keeps it awake.
    await session.send(stub.script(shell("sleep 4")))
    await stub.waitFor((call) => JSON.stringify(call.body.messages).includes('state=\\"completed\\"'))
    expect(lastToolResult(await session.turn(stub.script(shell(`tail -n 1 ${background}`))))).toContain("30000")
  })

  test("after the cell sleeps and wakes, a session's tools run on its sandbox, and one without has none", async () => {
    const onSandbox = await begin()
    const local = await begin(false)
    expect(await pwdOf(onSandbox)).toContain(join(first.directory, onSandbox.sessionId))
    await Promise.all(
      [onSandbox, local].map((session) =>
        session.opened.until((state) => Bun.deepEquals(state, TestCell.closed), 30_000),
      ),
    )
    expect(await pwdOf(onSandbox)).toContain(join(first.directory, onSandbox.sessionId))
    const call = await local.turn(stub.script(), 1)
    expect(call.tools.filter((tool) => fileTools.has(tool))).toEqual([])
  })

  test("workerd holds a tool's output stream open while a command runs for 20 seconds", async () => {
    const session = await begin()
    const started = Date.now()
    expect(lastToolResult(await session.turn(stub.script(shell("sleep 20 && echo late"))))).toBe(
      JSON.stringify("late\n"),
    )
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

  test("a cell killed while it asks Ren for access gets it at the next tool call after the restart", async () => {
    const session = await connect()
    const calls = { count: 0 }
    const access = await Effect.runPromise(
      Machine.access({
        url: first.url,
        environmentId,
        brain: Brain.ofSession(session.sessionId),
        directory: join(first.directory, session.sessionId),
        lifetimeMs: 3_600_000,
      }),
    )
    ren.answer(session.sessionId, () => (calls.count++ === 0 ? { type: "hold" } : { type: "access", access }))
    await session.configure()
    expect((await session.start(true)).status).toBe(200)
    await session.send(stub.script(shell("pwd")))
    await ren.reached(session.sessionId)
    await cell.crash()
    await cell.start()
    expect(await pwdOf(session)).toContain(join(first.directory, session.sessionId))
  })

  test("an executor restarted while the cell sleeps is reached by the next tool call", async () => {
    const restarting = await restartable()
    const session = await begin(true, restarting)
    expect(await pwdOf(session)).toContain(restarting.directory)
    await session.opened.until((state) => Bun.deepEquals(state, TestCell.closed), 30_000)
    await restarting.restart()
    expect(await pwdOf(session)).toContain(join(restarting.directory, session.sessionId))
    await restarting.dispose()
  })

  test("an executor restarted during a command ends the call with the disconnected notice, and the next command works", async () => {
    const restarting = await restartable()
    const session = await begin(true, restarting)
    const pidFile = join(restarting.directory, `${crypto.randomUUID()}.pid`)
    const running = stub.script(shell(`echo $$ > ${pidFile}; exec sleep 120`))
    await session.send(running)
    await Effect.runPromise(Pid.read(pidFile))
    const restartedAt = Date.now()
    await restarting.restart()
    expect(lastToolResult(await running.called(2))).toContain("environment disconnected")
    expect(Date.now() - restartedAt).toBeLessThan(45_000)
    expect(await pwdOf(session)).toContain(join(restarting.directory, session.sessionId))
    await restarting.dispose()
  }, 120_000)

  test("a frozen cell sends no heartbeats, so the executor stops its command within 35 seconds", async () => {
    const session = await begin()
    const pidFile = join(first.directory, `${crypto.randomUUID()}.pid`)
    const running = stub.script(shell(`echo $$ > ${pidFile}; exec sleep 120`))
    await session.send(running)
    const pid = await Effect.runPromise(Pid.read(pidFile))
    signalCell(cell, "STOP")
    const stoppedAfter = await waitUntil(() => !Processes.running(pid), 60_000)
    signalCell(cell, "CONT")
    running.set({ reply: "stopped" })
    if (stoppedAfter === undefined) process.kill(pid, "SIGKILL")
    expect(stoppedAfter).toBeLessThan(35_000)
    expect(await pwdOf(session)).toContain(join(first.directory, session.sessionId))
  }, 150_000)

  test("a background job stops on the sandbox when the cell closes the session's harness", async () => {
    const session = await begin()
    const pidFile = join(first.directory, `${crypto.randomUUID()}.pid`)
    const job = stub.script({
      tool: { name: "shell", input: { command: `echo $$ > ${pidFile}; exec sleep 300`, background: true } },
    })
    await session.turn(job)
    const pid = await Effect.runPromise(Pid.read(pidFile))
    await session.opened.until((state) => Bun.deepEquals(state, TestCell.closed), 60_000)
    const stoppedAfter = await waitUntil(() => !Processes.running(pid), 45_000)
    if (stoppedAfter === undefined) process.kill(pid, "SIGKILL")
    expect(stoppedAfter).toBeDefined()
  }, 150_000)

  test("a cell restarted during the 30-second wait after Ren failed asks Ren once at the next tool call", async () => {
    const session = await connect()
    ren.answer(session.sessionId, () => ({ type: "unavailable", message: "Ren is restarting" }))
    await session.configure()
    expect((await session.start(true)).status).toBe(200)
    expect(await pwdOf(session)).toContain("Ren is restarting")
    await place(session.sessionId, first)
    await cell.crash()
    await cell.start()
    const before = ren.accessCalls(session.sessionId)
    expect(await pwdOf(session)).toContain(join(first.directory, session.sessionId))
    expect(ren.accessCalls(session.sessionId) - before).toBe(1)
  })

  test("killing one cell leaves the commands of another cell on the same sandbox running", async () => {
    const other = await Wrangler.make(withRen)
    const survivor = await begin()
    const opened = await TestCell.make(other.url)
    const victimId = Session.ID.make(opened.id)
    await place(victimId, first)
    expect((await opened.models(Shared.access(), await FakeRen.hostToken(victimId))).status).toBe(204)
    expect(
      (
        await opened.brain("/ren/sessions", {
          sessionId: victimId,
          harness: "opencode",
          interactive: false,
          environment: { environmentId, directory: Environment.sessionDirectory(victimId) },
        })
      ).status,
    ).toBe(200)
    const marker = join(first.directory, `${crypto.randomUUID()}.pid`)
    const lasting = stub.script(shell(`echo $$ > ${marker}; sleep 4; echo survived`))
    await survivor.send(lasting)
    await Effect.runPromise(Pid.read(marker))
    await opened.brain(`/ren/sessions/${victimId}/messages`, {
      messageId: Session.MessageID.create(),
      prompt: { text: `${stub.script(shell("exec sleep 120")).marker} use the tool` },
      sender: { userId: "user_1" },
    })
    await other.crash()
    expect(lastToolResult(await lasting.called(2))).toBe(JSON.stringify("survived\n"))
    await other.dispose()
  }, 240_000)

  test("a host token that expires soon makes the next send ask Ren for a new configuration, and then tools work", async () => {
    const session = await connect()
    await place(session.sessionId, first)
    expect((await session.opened.models(Shared.access(), await FakeRen.hostToken(session.sessionId, 60))).status).toBe(
      204,
    )
    expect((await session.start(true)).status).toBe(409)
    await session.configure()
    expect((await session.start(true)).status).toBe(200)
    expect(await pwdOf(session)).toContain(join(first.directory, session.sessionId))
  })

  test("removing a brain's models during a command lets the command finish, and refuses the next send", async () => {
    const session = await begin()
    const done = join(first.directory, session.sessionId, `${crypto.randomUUID()}.done`)
    const running = stub.script(shell(`sleep 2; echo finished > ${done}`))
    await session.send(running)
    await ren.reached(session.sessionId)
    const before = ren.accessCalls(session.sessionId)
    expect((await session.opened.removeModels()).status).toBe(204)
    await waitUntil(() => Bun.spawnSync(["test", "-f", done]).exitCode === 0, 30_000)
    expect(await Bun.file(done).text()).toBe("finished\n")
    const refused = await session.opened.brain(`/ren/sessions/${session.sessionId}/messages`, {
      messageId: Session.MessageID.create(),
      prompt: { text: `${stub.script(shell("pwd")).marker} use the tool` },
      sender: { userId: "user_1" },
    })
    expect([refused.status, ren.accessCalls(session.sessionId) - before]).toEqual([409, 0])
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
