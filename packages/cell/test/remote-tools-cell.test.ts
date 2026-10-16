import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { BunHttpServer, BunServices } from "@effect/platform-bun"
import { EnvironmentToken } from "@ren/brain-api/environment-token"
import { Signature } from "@ren/brain-api/signature"
import { NodeCompatible } from "@ren/executor/node-compatible"
import { Server } from "@ren/executor/server"
import { Relay } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { ConfigProvider, DateTime, Effect, Exit, Layer, ManagedRuntime, Schema, Scope } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Celld } from "./lib/celld.js"
import { Shared } from "./lib/shared.js"
import type { StubModel } from "./lib/stub-model.js"
import { TestCell } from "./lib/test-cell.js"
import { Wrangler } from "./lib/wrangler.js"

setDefaultTimeout(60_000)

const pair = await Effect.runPromise(Signature.generate("test"))
const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-environment-")))
const stub = Shared.stub()
const fileTools = ["read", "write", "edit", "glob", "grep", "shell"]
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
const relayScope = Effect.runSync(Scope.make())
let cell: Celld.Instance
let relay: Relay.Instance

// oxlint-disable-next-line ren/no-comments -- celld 0.6.2 does not implement node:fs.createWriteStream or url.pathToFileURL, which OpenCode's shell and read tools use in the cell. Run with CELL_RUNTIME=wrangler.
const suite = wrangler ? describe : describe.skip

suite("remote tools in a cell", () => {
  beforeAll(async () => {
    const server = await executor.runPromise(HttpServer.HttpServer)
    relay = await Effect.runPromise(
      Relay.make(Relay.portOf(HttpServer.formatAddress(server.address))).pipe(Scope.provide(relayScope)),
    )
    const expiresAt = DateTime.makeUnsafe(Date.now() + 3_600_000)
    const access = {
      environmentId,
      url: relay.url,
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
    await Effect.runPromise(Scope.close(relayScope, Exit.void))
    await executor.dispose()
  })

  const begin = async (environments: ReadonlyArray<Environment.Location> = [{ environmentId, directory: workspace }]) => {
    const opened = await TestCell.make(cell.url)
    expect((await opened.models()).status).toBe(204)
    const started = await opened.brain("/ren/sessions", {
      sessionId: opened.id,
      harness: "opencode",
      interactive: false,
      environments,
    })
    expect(started.status).toBe(200)
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
      send,
      turn: async (script: StubModel.Script, calls = 2) => {
        await send(script)
        return script.called(calls)
      },
    }
  }

  const toolOutput = (call: StubModel.Call) =>
    call.body.messages
      .filter((message) => message.role === "tool")
      .map((message) => JSON.stringify(message.content))
      .join("\n")

  const run = async (tool: { readonly name: string; readonly input: unknown }) => {
    const session = await begin()
    return toolOutput(await session.turn(stub.script({ tool })))
  }

  const shell = (command: string) => ({ tool: { name: "shell", input: { command } } })

  const pidIn = async (path: string, deadline = Date.now() + 10_000): Promise<number> => {
    const pid = Number.parseInt((await Bun.file(path).exists()) ? await Bun.file(path).text() : "", 10)
    if (Number.isInteger(pid)) return pid
    if (Date.now() > deadline) throw new Error(`${path} never held a pid`)
    await Bun.sleep(50)
    return pidIn(path, deadline)
  }

  const running = (pid: number) => Bun.spawnSync(["kill", "-0", String(pid)]).exitCode === 0

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

  test("a cell writes, edits and globs the environment", async () => {
    const name = `cell-${crypto.randomUUID().slice(0, 8)}.txt`
    await run({ name: "write", input: { path: name, content: "before edit\n" } })
    expect(await Bun.file(join(workspace, name)).text()).toBe("before edit\n")
    await run({ name: "edit", input: { path: name, oldString: "before", newString: "after" } })
    expect(await Bun.file(join(workspace, name)).text()).toBe("after edit\n")
    expect(await run({ name: "glob", input: { pattern: "cell-*.txt" } })).toContain(name)
  })

  test("a cell offers the file and shell tools only to a session on an environment", async () => {
    const attached = await (await begin()).turn(stub.script(), 1)
    expect(fileTools.filter((tool) => !attached.tools.includes(tool))).toEqual([])
    const detached = await (await begin([])).turn(stub.script(), 1)
    expect(detached.tools.filter((tool) => fileTools.includes(tool))).toEqual([])
  })

  test("interrupting a cell's turn kills its command on the environment", async () => {
    const session = await begin()
    const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
    await session.send(stub.script(shell(`echo $$ > ${pidFile}; exec sleep 60`)))
    const pid = await pidIn(pidFile)
    await session.opened.opencode.session.interrupt({ sessionID: session.opened.id })
    const deadline = Date.now() + 5_000
    const exited = async (): Promise<boolean> => {
      if (!running(pid)) return true
      if (Date.now() > deadline) return false
      await Bun.sleep(50)
      return exited()
    }
    const killed = await exited()
    if (!killed) process.kill(pid, "SIGKILL")
    expect(killed).toBe(true)
  })

  test("a cell reconnects to the environment after it restarts", async () => {
    const session = await begin()
    expect(toolOutput(await session.turn(stub.script(shell("echo $((20 + 3))"))))).toContain("23")
    await cell.kill()
    await cell.start()
    expect(toolOutput(await session.turn(stub.script(shell("echo $((30 + 4))"))))).toContain("34")
  }, 180_000)

  test("a cell gives the model a command's whole result when the network drops for a moment", async () => {
    const session = await begin()
    const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
    const script = stub.script(
      shell(`echo $$ > ${pidFile}; for i in 1 2 3 4; do echo line$i; sleep 0.5; done; echo exit-code-next; exit 3`),
    )
    await session.send(script)
    await pidIn(pidFile)
    await Bun.sleep(700)
    await Effect.runPromise(relay.cut)
    const result = toolOutput(await script.called(2))
    expect(["line1", "line2", "line3", "line4", "exit-code-next"].filter((line) => !result.includes(line))).toEqual([])
    expect(result).toContain("Exited with code 3")
    expect(result).not.toContain("environment disconnected")
  })
})
