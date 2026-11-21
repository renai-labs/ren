import { afterAll, expect, test } from "bun:test"
import { FaultProxy } from "../lib/faults/proxy.js"

const upstream = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => {
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

test("a byte cut delivers exactly the configured bytes, then breaks the stream", async () => {
  proxy.inject({ operation: "process.output" }, { type: "cut-after-bytes", bytes: 13 })
  expect(await call("process.output")).toMatchObject({ status: 200, bytes: 13, failed: true })
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
