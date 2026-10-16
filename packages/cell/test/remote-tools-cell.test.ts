import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { BunHttpServer, BunServices } from "@effect/platform-bun"
import { EnvironmentToken } from "@ren/brain-api/environment-token"
import { Signature } from "@ren/brain-api/signature"
import { NodeCompatible } from "@ren/executor/node-compatible"
import { Server } from "@ren/executor/server"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { ConfigProvider, DateTime, Effect, Layer, ManagedRuntime, Schema } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Celld } from "./lib/celld.js"
import { Shared } from "./lib/shared.js"
import { TestCell } from "./lib/test-cell.js"
import { Wrangler } from "./lib/wrangler.js"

setDefaultTimeout(60_000)

const pair = await Effect.runPromise(Signature.generate("test"))
const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-environment-")))
const stub = Shared.stub()
const executor = ManagedRuntime.make(
  HttpRouter.serve(Server.layer, { disableLogger: true }).pipe(
    Layer.provide(HttpServer.layerServices),
    Layer.provide(NodeCompatible.layer),
    Layer.provide(BunServices.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          EXECUTOR_ENVIRONMENT_ID: environmentId,
          EXECUTOR_WORKSPACE: workspace,
          BRAIN_PUBLIC_KEYS: Schema.encodeSync(Signature.PublicKeys)([pair.publicKey]),
        }),
      ),
    ),
    Layer.provideMerge(BunHttpServer.layer({ port: 0, hostname: "127.0.0.1" })),
  ),
)
const wrangler = process.env.CELL_RUNTIME === "wrangler"
let cell: Celld.Instance

// oxlint-disable-next-line ren/no-comments -- celld 0.6.2 does not implement node:fs.createWriteStream or url.pathToFileURL, which OpenCode's shell and read tools use in the cell. Run with CELL_RUNTIME=wrangler.
const suite = wrangler ? describe : describe.skip

suite("remote tools in a cell", () => {
  beforeAll(async () => {
    const server = await executor.runPromise(HttpServer.HttpServer)
    const port = "port" in server.address ? server.address.port : 0
    const expiresAt = DateTime.makeUnsafe(Date.now() + 3_600_000)
    const access = {
      environmentId,
      url: `http://127.0.0.1:${port}`,
      token: await Effect.runPromise(
        EnvironmentToken.sign(pair.privateKey, {
          env: environmentId,
          brain: Brain.ID.create(),
          exp: Math.floor(DateTime.toEpochMillis(expiresAt) / 1000),
        }),
      ),
      expiresAt,
      generation: 1,
    }
    const vars = {
      TEST_ENVIRONMENT_ACCESS: Schema.encodeSync(
        Schema.fromJsonString(Schema.toCodecJson(Schema.Array(Environment.Access))),
      )([access]),
    }
    cell = await Wrangler.make({ ...Shared.vars(stub.url), ...vars }, "test/lib/environment-worker.ts")
  }, 180_000)

  afterAll(async () => {
    await cell.dispose()
    await executor.dispose()
  })

  const run = async (tool: { readonly name: string; readonly input: unknown }) => {
    const opened = await TestCell.make(cell.url)
    expect((await opened.models()).status).toBe(204)
    const started = await opened.brain("/ren/sessions", {
      sessionId: opened.id,
      harness: "opencode",
      interactive: false,
      environments: [{ environmentId, directory: workspace }],
    })
    expect(started.status).toBe(200)
    const script = stub.script({ tool })
    const sent = await opened.brain(`/ren/sessions/${opened.id}/messages`, {
      messageId: Session.MessageID.create(),
      prompt: { text: `${script.marker} use the tool` },
      sender: { userId: "user_1" },
    })
    expect(sent.status).toBe(200)
    const answered = await script.called(2)
    return answered.body.messages
      .filter((message) => message.role === "tool")
      .map((message) => JSON.stringify(message.content))
      .join("\n")
  }

  test("a cell reads and greps the environment through its executor", async () => {
    const marker = `needle${crypto.randomUUID().slice(0, 8)}`
    await Bun.write(join(workspace, "notes.md"), `remote ${marker}\n`)
    expect(await run({ name: "read", input: { path: "notes.md" } })).toContain(marker)
    expect(await run({ name: "grep", input: { pattern: marker } })).toContain("notes.md")
  })

  test("a cell runs a session's shell tool on the environment's executor", async () => {
    expect(await run({ name: "shell", input: { command: "echo hello > cell.txt && ls" } })).toContain("cell.txt")
    expect(await Bun.file(join(workspace, "cell.txt")).text()).toBe("hello\n")
  })

  test("a cell holds a tool's output stream open while the command runs", async () => {
    const started = Date.now()
    expect(await run({ name: "shell", input: { command: "sleep 20 && echo late" } })).toContain("late")
    expect(Date.now() - started).toBeGreaterThanOrEqual(20_000)
  })
})
