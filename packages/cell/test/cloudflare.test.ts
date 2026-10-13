import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import { Shared } from "./lib/shared.js"
import { TestCell } from "./lib/test-cell.js"
import { Wrangler } from "./lib/wrangler.js"

setDefaultTimeout(120_000)

describe.skipIf(process.env.CELL_RUNTIME !== "wrangler")("Wrangler local runtime", () => {
  const state: { instance: ReturnType<typeof Wrangler.make> | undefined } = { instance: undefined }
  const instance = () => (state.instance ??= Wrangler.make(Shared.vars(Shared.stub().url)))
  beforeAll(instance)
  afterAll(async () => {
    await state.instance?.then((worker) => worker.dispose())
  })

  test("the production worker boots from the shared wrangler.jsonc and rejects an unauthenticated request", async () => {
    expect((await fetch((await instance()).url)).status).toBe(401)
  })

  test("an object reached through getByName exposes the session name used by the Brain API authorization check", async () => {
    const cell = await TestCell.make((await instance()).url)
    expect((await cell.brain("/ren/sessions", { sessionId: cell.id, harness: "opencode" })).status).toBe(200)
    expect((await cell.brain("/ren/sessions", { sessionId: `${cell.id}other`, harness: "opencode" })).status).toBe(403)
  })

  test("a completed session survives a Wrangler restart with the same persisted storage", async () => {
    const worker = await instance()
    const cell = await TestCell.make(worker.url)
    await cell.start()
    const script = Shared.stub().script({ reply: "persisted answer" })
    await cell.prompt(script.marker)
    await cell.opencode.session.wait({ sessionID: cell.id })
    const messages = await cell.messages()
    expect(messages.some((message) => message.type === "idle")).toBe(true)
    await worker.kill()
    await expect(fetch(worker.url)).rejects.toThrow()
    await worker.start()
    expect(await cell.messages()).toEqual(messages)
  })

  test("two fixture instances have isolated durable storage and dispose their child processes and state", async () => {
    const worker = await instance()
    const projects = (await fs.readdir(os.tmpdir())).filter((name) => name.startsWith("ren-wrangler-")).toSorted()
    const other = await Wrangler.make(Shared.vars(Shared.stub().url))
    await using cleanup = { ...other, [Symbol.asyncDispose]: other.dispose }
    const cell = await TestCell.make(worker.url)
    await cell.start()
    const response = await fetch(`${cleanup.url}/api/session/${cell.id}`, { headers: { authorization: cell.server } })
    expect(response.status).toBe(404)
    await cleanup.dispose()
    await expect(fetch(cleanup.url)).rejects.toThrow()
    expect((await fs.readdir(os.tmpdir())).filter((name) => name.startsWith("ren-wrangler-")).toSorted()).toEqual(
      projects,
    )
  })

  test("a failed startup reports Wrangler output and disposes its process and temporary state", async () => {
    const projects = (await fs.readdir(os.tmpdir())).filter((name) => name.startsWith("ren-wrangler-")).toSorted()
    await expect(Wrangler.make(Shared.vars(Shared.stub().url), "src/missing-worker.ts")).rejects.toThrow(
      "Wrangler failed to serve",
    )
    expect((await fs.readdir(os.tmpdir())).filter((name) => name.startsWith("ren-wrangler-")).toSorted()).toEqual(
      projects,
    )
  })
})

describe("real Cloudflare deployment", () => {
  test.todo.each([
    "the unchanged production worker deploys with the shared config and accepts Brain API start and send",
    "getByName preserves the session identity and a foreign session id is rejected with 403",
    "a turn longer than 30 seconds completes after send returns with no subsequent client request",
    "a turn exceeding the alarm wait budget completes through later alarms without a client request",
    "after the model observes completion, the cell eventually closes its harness and clears its alarm",
    "a cold cell and a long tool-call transcript have recorded peak isolate memory against the 128 MB limit",
    "multiple active cells sharing an isolate complete turns with recorded peak memory and no memory-limit errors",
  ])("%s", () => {
    throw new Error("Requires an authenticated Cloudflare deployment")
  })
})
