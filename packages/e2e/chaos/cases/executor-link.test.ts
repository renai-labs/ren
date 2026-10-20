import { afterAll, expect, test } from "bun:test"
import type { ProcessID } from "@ren/hand-api/executor-api"
import { Brain } from "@ren/schema/brain"
import { Effect, Exit, Stream } from "effect"
import path from "node:path"
import { ExecutorAdapter } from "../lib/adapters/executor.js"
import { ExecutorDriver } from "../lib/drivers/executor.js"
import { FaultProxy } from "../lib/faults/proxy.js"
import { Ledger } from "../lib/ledger.js"
import { Wait } from "../lib/wait.js"

const executor = await ExecutorAdapter.localProcess({ label: "executor-link" })

const proxy = await FaultProxy.make(executor.url())

const driver = await ExecutorDriver.connect(proxy.url, await ExecutorAdapter.token(executor.handId, Brain.ID.create()))

const lane = { executor, proxy, driver }

afterAll(async () => {
  await driver.dispose()
  await proxy.stop()
  await executor.dispose()
})

const encode = (text: string) => new TextEncoder().encode(text)

const file = (name: string) => Bun.file(path.join(lane.executor.workspace, name))

const shell = (script: string, hasStdin = false) =>
  lane.driver.ok(lane.driver.client["process.spawn"]({ command: "sh", arguments: ["-c", script], hasStdin }))

const dropNext = (operation: string) =>
  lane.proxy.inject({ operation, attempt: lane.proxy.count(operation) + 1 }, { type: "drop-response" })

const unique = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

test("a kill whose reply is lost stopped the process once and is not resent", async () => {
  const spawned = await lane.driver.ok(lane.driver.client["process.spawn"]({ command: "sleep", arguments: ["30"] }))
  const before = lane.proxy.count("process.kill")
  const fault = dropNext("process.kill")
  const exit = await lane.driver.run(lane.driver.client["process.kill"]({ id: spawned.id, signal: "SIGTERM" }))
  expect(fault.expectApplied().boundary).toBe("after-commit-before-reply")
  expect(Exit.isFailure(exit)).toBe(true)
  expect((await lane.driver.output(spawned.id)).exit).toEqual({ type: "exit", exitCode: null, signal: "SIGTERM" })
  expect(lane.proxy.count("process.kill")).toBe(before + 1)
})

test("a spawn whose reply is lost ran once and is not resent", async () => {
  const marker = Ledger.marker("spawn")
  const fault = lane.proxy.inject(
    { operation: "process.spawn", when: (request) => request.body.includes(marker) },
    { type: "drop-response" },
  )
  expect(
    Exit.isFailure(
      await lane.driver.run(
        lane.driver.client["process.spawn"]({ command: "sh", arguments: ["-c", Ledger.append(marker)] }),
      ),
    ),
  ).toBe(true)
  expect(fault.expectApplied().boundary).toBe("after-commit-before-reply")
  await Wait.until("the spawned side effect", 5_000, async () =>
    (await Ledger.count(lane.executor, marker)) > 0 ? true : undefined,
  )
  expect(await Ledger.count(lane.executor, marker)).toBe(1)
  expect(lane.proxy.seen.filter((entry) => entry.body.includes(marker))).toHaveLength(1)
})

test("a spawn refused before delivery has no side effect", async () => {
  const marker = Ledger.marker("refused")
  const fault = lane.proxy.inject(
    { operation: "process.spawn", when: (request) => request.body.includes(marker) },
    { type: "refuse" },
  )
  expect(
    Exit.isFailure(
      await lane.driver.run(
        lane.driver.client["process.spawn"]({ command: "sh", arguments: ["-c", Ledger.append(marker)] }),
      ),
    ),
  ).toBe(true)
  expect(fault.expectApplied().boundary).toBe("before-delivery")
  expect(await Ledger.count(lane.executor, marker)).toBe(0)
})

test("stdin whose reply is lost was delivered once and is not resent", async () => {
  const marker = Ledger.marker("stdin")
  const spawned = await shell(`cat >> ${Ledger.file}`, true)
  const before = lane.proxy.count("process.write")
  const fault = dropNext("process.write")
  const exit = await lane.driver.run(
    lane.driver.client["process.write"]({ id: spawned.id, data: encode(`${marker}\n`), end: false }),
  )
  expect(fault.expectApplied().operation).toBe("process.write")
  expect(Exit.isFailure(exit)).toBe(true)
  await lane.driver.ok(lane.driver.client["process.write"]({ id: spawned.id, data: new Uint8Array(), end: true }))
  await lane.driver.output(spawned.id)
  expect(await Ledger.count(lane.executor, marker)).toBe(1)
  expect(lane.proxy.count("process.write")).toBe(before + 2)
})

const twice = async (label: string) => {
  const random = Wait.random(label)
  const alphabet = ["a", "b", "é", "€", "😀", "\n", "z", "ß"]
  const content = encode(
    Array.from({ length: 40_000 }, () => alphabet[random.integer(0, alphabet.length - 1)] ?? "a").join(""),
  )
  const name = `${unique("payload")}.txt`
  await lane.driver.ok(lane.driver.client["files.write"]({ path: name, bytes: content }))
  return {
    script: `cat '${name}'; sleep 0.4; cat '${name}'`,
    expected: new TextDecoder().decode(new Uint8Array([...content, ...content])),
    cutAt: random.integer(40, 4_000),
  }
}

const resume = async (id: ProcessID) => {
  const parts: Array<Uint8Array> = []
  const state = { position: 0, gaps: 0, exit: false, connections: 0 }
  const connect = async (): Promise<void> => {
    state.connections += 1
    await Effect.runPromiseExit(
      lane.driver.client["process.output"]({ id, cursor: state.position }).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (event.type === "exit") state.exit = true
            if (event.type !== "stdout") return
            if (event.offset > state.position) state.gaps += 1
            parts.push(
              event.offset < state.position ? event.bytes.subarray(state.position - event.offset) : event.bytes,
            )
            state.position = Math.max(state.position, event.offset + event.bytes.length)
          }),
        ),
      ),
    )
    if (state.exit || state.connections >= 10) return
    return connect()
  }
  await Wait.deadline(`resuming the output of ${id}`, 30_000, connect())
  return { text: new TextDecoder().decode(Buffer.concat(parts)), ...state }
}

test(`output cut at a seeded byte inside a frame resumes from the cursor exactly (seed ${Wait.seed})`, async () => {
  const prepared = await twice("output.cut-inside-frame")
  const fault = lane.proxy.inject(
    { operation: "process.output", attempt: lane.proxy.count("process.output") + 1 },
    { type: "cut-after-bytes", bytes: prepared.cutAt },
  )
  const resumed = await resume((await shell(prepared.script)).id)
  expect(fault.expectApplied().boundary).toBe(`response-byte-${prepared.cutAt}`)
  expect(resumed).toMatchObject({ gaps: 0, exit: true })
  expect(resumed.connections).toBeGreaterThan(1)
  expect(resumed.text).toBe(prepared.expected)
})

test("output cut at a line boundary resumes with no loss or duplicate", async () => {
  const prepared = await twice("output.cut-at-line-boundary")
  const fault = lane.proxy.inject(
    { operation: "process.output", attempt: lane.proxy.count("process.output") + 1 },
    { type: "cut-after-lines", lines: 1 },
  )
  const resumed = await resume((await shell(prepared.script)).id)
  expect(fault.expectApplied().boundary).toBe("response-line-1")
  expect(resumed).toMatchObject({ gaps: 0, exit: true })
  expect(resumed.text).toBe(prepared.expected)
})

test("a file write whose reply is lost took effect and an identical retry is harmless", async () => {
  const name = `${unique("lost-write")}.txt`
  const fault = dropNext("files.write")
  expect(
    Exit.isFailure(await lane.driver.run(lane.driver.client["files.write"]({ path: name, bytes: encode("payload") }))),
  ).toBe(true)
  fault.expectApplied()
  expect(await file(name).text()).toBe("payload")
  await lane.driver.ok(lane.driver.client["files.write"]({ path: name, bytes: encode("payload") }))
  expect(await file(name).text()).toBe("payload")
})

test("a move whose reply is lost took effect and a blind retry fails explicitly", async () => {
  const from = `${unique("from")}.txt`
  const to = `${unique("to")}.txt`
  await lane.driver.ok(lane.driver.client["files.write"]({ path: from, bytes: encode("moved once") }))
  const fault = dropNext("files.move")
  expect(Exit.isFailure(await lane.driver.run(lane.driver.client["files.move"]({ from, to })))).toBe(true)
  fault.expectApplied()
  expect([await file(from).exists(), await file(to).text()]).toEqual([false, "moved once"])
  expect(ExecutorDriver.errorTag(await lane.driver.run(lane.driver.client["files.move"]({ from, to })))).toBe(
    "FileNotFoundError",
  )
  expect(await file(to).text()).toBe("moved once")
})

test("a remove whose reply is lost took effect and a retry succeeds", async () => {
  const name = `${unique("lost-remove")}.txt`
  await lane.driver.ok(lane.driver.client["files.write"]({ path: name, bytes: encode("x") }))
  const fault = dropNext("files.remove")
  expect(Exit.isFailure(await lane.driver.run(lane.driver.client["files.remove"]({ path: name })))).toBe(true)
  fault.expectApplied()
  expect(await file(name).exists()).toBe(false)
  await lane.driver.ok(lane.driver.client["files.remove"]({ path: name }))
})

test("a mkdir whose reply is lost took effect and a retry succeeds", async () => {
  const name = unique("lost-mkdir")
  const fault = dropNext("files.mkdir")
  expect(Exit.isFailure(await lane.driver.run(lane.driver.client["files.mkdir"]({ path: name })))).toBe(true)
  fault.expectApplied()
  expect((await lane.driver.ok(lane.driver.client["files.stat"]({ path: name }))).type).toBe("directory")
  await lane.driver.ok(lane.driver.client["files.mkdir"]({ path: name }))
})
