import { afterAll, expect, test } from "bun:test"
import { FaultProxy } from "../lib/faults/proxy.js"

const received: Array<string> = []

const upstream = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    received.push(await request.text())
    const lines = Array.from({ length: 5 }, (_, index) => JSON.stringify({ line: index, text: "é漢🙂" }))
    return new Response(`${lines.join("\n")}\n`, { headers: { "content-type": "application/ndjson" } })
  },
})

const proxy = await FaultProxy.make(`http://127.0.0.1:${upstream.port ?? 0}`)

afterAll(async () => {
  await proxy.stop()
  await upstream.stop(true)
})

const call = async (tag: string) => {
  const response = await fetch(`${proxy.url}/v1/rpc`, {
    method: "POST",
    body: `${JSON.stringify({ _tag: "Request", id: "1", tag, payload: {}, headers: [] })}\n`,
  }).catch(() => undefined)
  const reader = response?.body?.getReader()
  const read = async (bytes: number): Promise<{ readonly bytes: number; readonly failed: boolean }> => {
    const chunk = await reader?.read().catch(() => undefined)
    if (!chunk) return { bytes, failed: true }
    return chunk.done ? { bytes, failed: false } : read(bytes + chunk.value.length)
  }
  return { status: response?.status ?? 0, ...(await read(0)) }
}

const delivered = (tag: string) => received.filter((body) => body.includes(`"tag":"${tag}"`)).length

const whole = new TextEncoder().encode(
  `${Array.from({ length: 5 }, (_, index) => JSON.stringify({ line: index, text: "é漢🙂" })).join("\n")}\n`,
)

test("a refused request never reaches the upstream", async () => {
  const rule = proxy.inject({ operation: "files.write" }, { type: "refuse" })
  expect((await call("files.write")).status).toBe(0)
  expect(rule.expectApplied()).toEqual({ operation: "files.write", attempt: 1, boundary: "before-delivery" })
  expect(delivered("files.write")).toBe(0)
})

test("a dropped response reaches the upstream once and the caller gets no reply", async () => {
  const rule = proxy.inject({ operation: "files.remove" }, { type: "drop-response" })
  expect((await call("files.remove")).status).toBe(0)
  expect(rule.expectApplied().boundary).toBe("after-commit-before-reply")
  expect(delivered("files.remove")).toBe(1)
})

test("a status reply is answered by the proxy without reaching the upstream", async () => {
  const rule = proxy.inject({ operation: "files.read" }, { type: "status", status: 503 })
  expect((await call("files.read")).status).toBe(503)
  expect(rule.expectApplied().boundary).toBe("before-delivery")
  expect(delivered("files.read")).toBe(0)
})

test("a byte cut delivers exactly the configured bytes, then breaks the stream", async () => {
  proxy.inject({ operation: "process.output" }, { type: "cut-after-bytes", bytes: 13 })
  expect(await call("process.output")).toMatchObject({ status: 200, bytes: 13, failed: true })
})

test("a line cut delivers exactly the configured lines, then breaks the stream", async () => {
  proxy.inject({ operation: "process.spawn" }, { type: "cut-after-lines", lines: 2 })
  const lines = new TextDecoder().decode(whole).split("\n").slice(0, 2)
  expect(await call("process.spawn")).toMatchObject({
    status: 200,
    bytes: new TextEncoder().encode(`${lines.join("\n")}\n`).length,
    failed: true,
  })
})

test("a held request reaches the upstream and is answered only after release", async () => {
  const rule = proxy.inject({ operation: "files.move" }, { type: "hold" })
  const answered = { yet: false }
  const pending = call("files.move").finally(() => {
    answered.yet = true
  })
  await rule.committed
  expect([delivered("files.move"), answered.yet]).toEqual([1, false])
  rule.release()
  expect(await pending).toEqual({ status: 200, bytes: whole.length, failed: false })
})

test("a fault aimed at one attempt leaves the other attempts and operations alone", async () => {
  const rule = proxy.inject({ operation: "files.stat", attempt: 2 }, { type: "status", status: 500 })
  const other = proxy.inject({ operation: "files.mkdir", attempt: 5 }, { type: "refuse" })
  expect((await call("files.mkdir")).status).toBe(200)
  expect((await call("files.stat")).status).toBe(200)
  expect(rule.applied()).toBe(false)
  expect((await call("files.stat")).status).toBe(500)
  expect(rule.expectApplied().attempt).toBe(2)
  expect((await call("files.stat")).status).toBe(200)
  expect(() => other.expectApplied()).toThrow("was never applied")
})
