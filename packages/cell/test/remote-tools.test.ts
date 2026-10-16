import { expect, setDefaultTimeout } from "bun:test"
import { BunHttpServer, BunServices } from "@effect/platform-bun"
import { AbsolutePath } from "@opencode/client/effect"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { Environments } from "@ren/brain/environments"
import { EnvironmentAccess } from "@ren/brain/environment-access"
import { OpenCodeWorkspaceDriver } from "@ren/brain/opencode-workspace-driver"
import { EnvironmentToken } from "@ren/brain-api/environment-token"
import { Signature } from "@ren/brain-api/signature"
import { NodeCompatible } from "@ren/executor/node-compatible"
import { Server } from "@ren/executor/server"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { ConfigProvider, Context, DateTime, Effect, Exit, Layer, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Env } from "../src/env.js"
import type { Harness } from "../src/harness/harness.js"
import { OpenCodeHarness } from "../src/harness/opencode/harness.js"
import { Host } from "../src/harness/opencode/host.js"
import { testEffect } from "./lib/effect.js"
import { Shared } from "./lib/shared.js"
import type { StubModel } from "./lib/stub-model.js"

setDefaultTimeout(30_000)

const pair = await Effect.runPromise(Signature.generate("test"))
const publicKeys = Schema.encodeSync(Signature.PublicKeys)([pair.publicKey])
const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-environment-")))
const local = await realpath(await mkdtemp(join(tmpdir(), "ren-local-")))
const stub = Shared.stub()
const fileTools = ["read", "write", "edit", "glob", "grep", "shell"]

const it = testEffect(
  HttpRouter.serve(Server.layer, { disableLogger: true }).pipe(
    Layer.provide(HttpServer.layerServices),
    Layer.provide(NodeCompatible.layer),
    Layer.provide(BunServices.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          EXECUTOR_ENVIRONMENT_ID: environmentId,
          EXECUTOR_WORKSPACE: workspace,
          BRAIN_PUBLIC_KEYS: publicKeys,
        }),
      ),
    ),
    Layer.provideMerge(BunHttpServer.layer({ port: 0, hostname: "127.0.0.1" })),
  ),
)

const accessTo = Effect.fnUntraced(function* (
  url: string,
  options: { readonly brain: Brain.ID; readonly lifetimeMs: number },
) {
  const expiresAt = DateTime.makeUnsafe(Date.now() + options.lifetimeMs)
  return {
    environmentId,
    url,
    token: yield* EnvironmentToken.sign(pair.privateKey, {
      env: environmentId,
      brain: options.brain,
      exp: Math.floor(DateTime.toEpochMillis(expiresAt) / 1000),
    }),
    expiresAt,
    generation: 1,
  }
})

const served = Effect.map(HttpServer.HttpServer, (server) => HttpServer.formatAddress(server.address))

const open = Effect.fnUntraced(function* (access: Layer.Layer<EnvironmentAccess.Service>, directory = workspace) {
  const environments = yield* Layer.build(
    Environments.layer.pipe(Layer.provide(access), Layer.provide(FetchHttpClient.layer)),
  ).pipe(Effect.map((context) => Context.get(context, Environments.Service)))
  const vars = Schema.decodeUnknownSync(Env.Vars)(Shared.vars(stub.url))
  const endpoints = Shared.access(undefined, stub.url).endpoints
  const host = yield* Host.make(
    createEmbeddedRoutes(
      {
        database: { path: ":memory:" },
        config: { project: false, content: vars.OPENCODE_CONFIG },
        models: { fetch: false },
        fs: { filewatcher: false, fff: false },
      },
      OpenCodeWorkspaceDriver.replacements(environments),
    ).pipe(Layer.provide(HttpServer.layerServices)),
    endpoints,
    () => Effect.succeedNone,
    true,
  )
  return yield* OpenCodeHarness.make(host, endpoints, AbsolutePath.make(directory))
})

const openServed = Effect.gen(function* () {
  const access = yield* accessTo(yield* served, { brain: Brain.ID.create(), lifetimeMs: 600_000 })
  return yield* open(EnvironmentAccess.layerFixed([access]))
})

const begin = Effect.fnUntraced(function* (
  harness: Harness.Instance,
  environments: ReadonlyArray<Environment.Location> = [{ environmentId, directory: workspace }],
) {
  const sessionId = Session.ID.create()
  yield* harness.start({ sessionId, harness: "opencode", instructions: {}, interactive: false, environments })
  const send = (script: StubModel.Script) =>
    harness.send({
      sessionId,
      messageId: Session.MessageID.create(),
      prompt: { text: `${script.marker} use the tool` },
      delivery: "steer",
      sender: { userId: "user_1" },
    })
  return {
    sessionId,
    send,
    turn: (script: StubModel.Script, calls = 2) =>
      send(script).pipe(Effect.andThen(Effect.promise(() => script.called(calls)))),
  }
})

const toolOutput = (call: StubModel.Call) =>
  call.body.messages
    .filter((message) => message.role === "tool")
    .map((message) => JSON.stringify(message.content))
    .join("\n")

const run = Effect.fnUntraced(function* (tool: { readonly name: string; readonly input: unknown }) {
  const session = yield* begin(yield* openServed)
  return toolOutput(yield* session.turn(stub.script({ tool })))
})

const shell = (command: string) => ({ tool: { name: "shell", input: { command } } })

const pidIn = (path: string) =>
  Effect.promise(async () => ((await Bun.file(path).exists()) ? Bun.file(path).text() : "")).pipe(
    Effect.map((text) => Number.parseInt(text, 10)),
    Effect.repeat({ until: Number.isInteger, schedule: Schedule.spaced(50) }),
    Effect.timeout(10_000),
  )

const exits = (pid: number) =>
  Effect.exit(Effect.try(() => process.kill(pid, 0))).pipe(
    Effect.map(Exit.isSuccess),
    Effect.repeat({ while: (running) => running, schedule: Schedule.spaced(50) }),
    Effect.timeout(5_000),
    Effect.as(true),
  )

it.live("runs the shell tool on the environment's executor, in the attached directory", () =>
  Effect.gen(function* () {
    const result = yield* run({ name: "shell", input: { command: "echo hello > hello.txt && ls && pwd" } })
    expect(result).toContain("hello.txt")
    expect(result).toContain(workspace)
    expect(yield* Effect.promise(() => Bun.file(join(workspace, "hello.txt")).text())).toBe("hello\n")
  }),
)

it.live("reads a file on the environment", () =>
  Effect.gen(function* () {
    const marker = crypto.randomUUID()
    yield* Effect.promise(() => Bun.write(join(workspace, "notes.md"), `remote ${marker}\n`))
    expect(yield* run({ name: "read", input: { path: "notes.md" } })).toContain(marker)
  }),
)

it.live("greps the environment with its own rg", () =>
  Effect.gen(function* () {
    const marker = `needle${crypto.randomUUID().slice(0, 8)}`
    yield* Effect.promise(() => Bun.write(join(workspace, "src/found.ts"), `export const ${marker} = 1\n`))
    const result = yield* run({ name: "grep", input: { pattern: marker } })
    expect(result).toContain("found.ts")
  }),
)

it.live("writes a file on the environment", () =>
  Effect.gen(function* () {
    const marker = crypto.randomUUID()
    yield* run({ name: "write", input: { path: "written.txt", content: `written ${marker}\n` } })
    expect(yield* Effect.promise(() => Bun.file(join(workspace, "written.txt")).text())).toBe(`written ${marker}\n`)
  }),
)

it.live("edits a file on the environment", () =>
  Effect.gen(function* () {
    yield* Effect.promise(() => Bun.write(join(workspace, "edited.txt"), "before edit\n"))
    yield* run({ name: "edit", input: { path: "edited.txt", oldString: "before", newString: "after" } })
    expect(yield* Effect.promise(() => Bun.file(join(workspace, "edited.txt")).text())).toBe("after edit\n")
  }),
)

it.live("globs the environment", () =>
  Effect.gen(function* () {
    const name = `globbed-${crypto.randomUUID().slice(0, 8)}.ts`
    yield* Effect.promise(() => Bun.write(join(workspace, "deep/er", name), "export {}\n"))
    expect(yield* run({ name: "glob", input: { pattern: "**/globbed-*.ts" } })).toContain(name)
  }),
)

it.live("runs every turn of a session on the environment", () =>
  Effect.gen(function* () {
    const file = `${crypto.randomUUID()}.txt`
    const session = yield* begin(yield* openServed)
    yield* session.turn(stub.script(shell(`echo one >> ${file}`)))
    yield* session.turn(stub.script(shell(`echo two >> ${file}`)))
    expect(yield* Effect.promise(() => Bun.file(join(workspace, file)).text())).toBe("one\ntwo\n")
  }),
)

it.live("runs a subagent's tools on its parent session's environment", () =>
  Effect.gen(function* () {
    const file = `${crypto.randomUUID()}.txt`
    const child = stub.script(shell(`echo $((40 + 2)) > ${file}`))
    const session = yield* begin(yield* openServed)
    yield* session.turn(
      stub.script({
        tool: {
          name: "subagent",
          input: { agent: "general", description: "Write a file", prompt: `${child.marker} write it` },
        },
      }),
    )
    expect(child.calls.length).toBeGreaterThanOrEqual(2)
    expect(yield* Effect.promise(() => Bun.file(join(workspace, file)).text())).toBe("42\n")
  }),
)

it.live("interrupting a turn kills its command on the environment", () =>
  Effect.gen(function* () {
    const harness = yield* openServed
    const session = yield* begin(harness)
    const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
    yield* session.send(stub.script(shell(`echo $$ > ${pidFile}; exec sleep 60`)))
    const pid = yield* pidIn(pidFile)
    const own = (yield* harness.sessions).find((state) => String(state.id) === session.sessionId)
    expect(own).toBeDefined()
    if (!own) return
    yield* own.interrupt
    expect(yield* exits(pid)).toBe(true)
  }),
)

it.live("offers the file and shell tools to a session on an environment", () =>
  Effect.gen(function* () {
    const session = yield* begin(yield* openServed)
    const call = yield* session.turn(stub.script(), 1)
    expect(fileTools.filter((tool) => !call.tools.includes(tool))).toEqual([])
  }),
)

it.live("offers no file or shell tools to a session without an environment, in a brain that has environments", () =>
  Effect.gen(function* () {
    const access = yield* accessTo(yield* served, { brain: Brain.ID.create(), lifetimeMs: 600_000 })
    const session = yield* begin(yield* open(EnvironmentAccess.layerFixed([access]), local), [])
    const call = yield* session.turn(stub.script(), 1)
    expect(call.tools.filter((tool) => fileTools.includes(tool))).toEqual([])
  }),
)

it.live("keeps running tools after the environment token expires between turns", () =>
  Effect.gen(function* () {
    const url = yield* served
    const brain = Brain.ID.create()
    const harness = yield* open(
      Layer.succeed(
        EnvironmentAccess.Service,
        EnvironmentAccess.Service.of({ open: () => accessTo(url, { brain, lifetimeMs: 2_000 }) }),
      ),
    )
    const session = yield* begin(harness)
    expect(toolOutput(yield* session.turn(stub.script(shell("echo $((20 + 3))"))))).toContain("23")
    yield* Effect.sleep(3_000)
    expect(toolOutput(yield* session.turn(stub.script(shell("echo $((30 + 4))"))))).toContain("34")
  }),
)

it.live("ends the turn, telling the model the command did not finish, when the executor dies mid-command", () =>
  Effect.gen(function* () {
    const socket = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
    const port = socket.port
    yield* Effect.promise(() => socket.stop(true))
    const url = `http://127.0.0.1:${port}`
    const executor = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.spawn(["bun", "run", Bun.resolveSync("@ren/executor/main", import.meta.dir)], {
          env: {
            ...process.env,
            PORT: String(port),
            EXECUTOR_ENVIRONMENT_ID: environmentId,
            EXECUTOR_WORKSPACE: workspace,
            BRAIN_PUBLIC_KEYS: publicKeys,
          },
          stdout: "ignore",
          stderr: "ignore",
        }),
      ),
      (child) => Effect.sync(() => child.kill("SIGKILL")),
    )
    yield* Effect.promise(() =>
      fetch(`${url}/v1/rpc`, { method: "POST" })
        .then((response) => response.status)
        .catch(() => 0),
    ).pipe(Effect.repeat({ until: (status) => status === 401, schedule: Schedule.spaced(100) }), Effect.timeout(10_000))
    const access = yield* accessTo(url, { brain: Brain.ID.create(), lifetimeMs: 600_000 })
    const session = yield* begin(yield* open(EnvironmentAccess.layerFixed([access])))
    const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
    const script = stub.script(shell(`echo $$ > ${pidFile}; exec sleep 30`))
    yield* session.send(script)
    const pid = yield* pidIn(pidFile)
    yield* Effect.addFinalizer(() => Effect.ignore(Effect.try(() => process.kill(pid, "SIGKILL"))))
    executor.kill("SIGKILL")
    const answered = yield* Effect.promise(() => script.called(2)).pipe(Effect.timeout(15_000))
    expect(toolOutput(answered)).not.toBe(JSON.stringify("(no output)"))
  }),
)
