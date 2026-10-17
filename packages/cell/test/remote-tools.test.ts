import { expect, setDefaultTimeout } from "bun:test"
import { BunHttpServer, BunServices } from "@effect/platform-bun"
import { AbsolutePath } from "@opencode/client/effect"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { EnvironmentBindings } from "@ren/brain/environment-bindings"
import { Environments } from "@ren/brain/environments"
import { EnvironmentAccess } from "@ren/brain/environment-access"
import { OpenCodeWorkspaceDriver } from "@ren/brain/opencode-workspace-driver"
import { EnvironmentToken } from "@ren/brain-api/environment-token"
import { Signature } from "@ren/brain-api/signature"
import { NodeCompatible } from "@ren/executor/node-compatible"
import { Server } from "@ren/executor/server"
import { Relay } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { ConfigProvider, Context, DateTime, Effect, Exit, Layer, Option, Schedule, Schema, Scope, Stream } from "effect"
import { KeyValueStore } from "effect/persistence"
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

const executor = (served: Environment.ID, directory: string) =>
  HttpRouter.serve(Server.layer, { disableLogger: true }).pipe(
    Layer.provide(HttpServer.layerServices),
    Layer.provide(NodeCompatible.layer),
    Layer.provide(BunServices.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          EXECUTOR_ENVIRONMENT_ID: served,
          EXECUTOR_WORKSPACE: directory,
          BRAIN_PUBLIC_KEYS: publicKeys,
        }),
      ),
    ),
    Layer.provideMerge(BunHttpServer.layer({ port: 0, hostname: "127.0.0.1" })),
  )

const it = testEffect(executor(environmentId, workspace))

const machine = Effect.fnUntraced(function* (served: Environment.ID) {
  const directory = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-machine-"))))
  const scope = yield* Scope.fork(yield* Scope.Scope)
  const context = yield* Layer.buildWithMemoMap(executor(served, directory), yield* Layer.makeMemoMap, scope)
  return {
    directory,
    url: HttpServer.formatAddress(Context.get(context, HttpServer.HttpServer).address),
    stop: Scope.close(scope, Exit.void),
  }
})

const accessTo = Effect.fnUntraced(function* (
  url: string,
  options: {
    readonly brain: Brain.ID
    readonly lifetimeMs: number
    readonly environmentId?: Environment.ID
    readonly generation?: number
  },
) {
  const expiresAt = DateTime.makeUnsafe(Date.now() + options.lifetimeMs)
  const id = options.environmentId ?? environmentId
  return {
    environmentId: id,
    url,
    token: yield* EnvironmentToken.sign(pair.privateKey, {
      env: id,
      brain: options.brain,
      exp: Math.floor(DateTime.toEpochMillis(expiresAt) / 1000),
    }),
    expiresAt,
    generation: options.generation ?? 1,
  }
})

const served = Effect.map(HttpServer.HttpServer, (server) => HttpServer.formatAddress(server.address))

const open = Effect.fnUntraced(function* (access: Layer.Layer<EnvironmentAccess.Service>, directory = workspace) {
  const context = yield* Layer.build(
    EnvironmentBindings.layer.pipe(
      Layer.provideMerge(Environments.layer),
      Layer.provide(access),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(KeyValueStore.layerMemory),
    ),
  )
  const environments = Context.get(context, Environments.Service)
  const bindings = Context.get(context, EnvironmentBindings.Service)
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
      OpenCodeWorkspaceDriver.replacements(environments, bindings),
    ).pipe(Layer.provide(HttpServer.layerServices)),
    endpoints,
    () => Effect.succeedNone,
    Option.some(bindings),
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

it.live("runs tools on an environment attached to a session after it started", () =>
  Effect.gen(function* () {
    const access = yield* accessTo(yield* served, { brain: Brain.ID.create(), lifetimeMs: 600_000 })
    const harness = yield* open(EnvironmentAccess.layerFixed([access]), local)
    const session = yield* begin(harness, [])
    yield* session.turn(stub.script(), 1)
    yield* harness.start({
      sessionId: session.sessionId,
      harness: "opencode",
      instructions: {},
      interactive: false,
      environments: [{ environmentId, directory: workspace }],
    })
    const file = `${crypto.randomUUID()}.txt`
    const answered = yield* session.turn(stub.script(shell(`echo attached > ${file} && pwd`)))
    expect(answered.tools).toContain("shell")
    expect(toolOutput(answered)).toContain(workspace)
    expect(yield* Effect.promise(() => Bun.file(join(workspace, file)).text())).toBe("attached\n")
  }),
)

const restart = (harness: Harness.Instance, sessionId: Session.ID, environments: ReadonlyArray<Environment.Location>) =>
  harness.start({ sessionId, harness: "opencode", instructions: {}, interactive: false, environments })

it.live("moves a session's tools to another environment between turns, and keeps its conversation", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const otherId = Environment.ID.create()
    const other = yield* machine(otherId)
    const harness = yield* open(
      EnvironmentAccess.layerFixed([
        yield* accessTo(yield* served, { brain, lifetimeMs: 600_000 }),
        yield* accessTo(other.url, { brain, lifetimeMs: 600_000, environmentId: otherId }),
      ]),
    )
    const session = yield* begin(harness)
    const file = `${crypto.randomUUID()}.txt`
    yield* session.turn(stub.script(shell(`echo first > ${file}`)))
    yield* restart(harness, session.sessionId, [{ environmentId: otherId, directory: other.directory }])
    const answered = yield* session.turn(stub.script(shell(`echo second > ${file} && pwd`)))
    expect(toolOutput(answered)).toContain(other.directory)
    expect(JSON.stringify(answered.body.messages)).toContain("first")
    expect(yield* Effect.promise(() => Bun.file(join(workspace, file)).text())).toBe("first\n")
    expect(yield* Effect.promise(() => Bun.file(join(other.directory, file)).text())).toBe("second\n")
  }),
)

it.live("tells the model which environment its tools run on after a move", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const otherId = Environment.ID.create()
    const other = yield* machine(otherId)
    const harness = yield* open(
      EnvironmentAccess.layerFixed([
        yield* accessTo(yield* served, { brain, lifetimeMs: 600_000 }),
        yield* accessTo(other.url, { brain, lifetimeMs: 600_000, environmentId: otherId }),
      ]),
    )
    const session = yield* begin(harness)
    yield* restart(harness, session.sessionId, [{ environmentId: otherId, directory: other.directory }])
    const call = yield* session.turn(stub.script(), 1)
    const prompt = JSON.stringify(call.body.messages)
    expect(prompt).toContain(otherId)
    expect(prompt).toContain(`Paths under ${workspace} refer to ${other.directory}`)
  }),
)

it.live("searches the environment's directory after a move to a different path", () =>
  Effect.gen(function* () {
    const access = yield* accessTo(yield* served, { brain: Brain.ID.create(), lifetimeMs: 600_000 })
    const harness = yield* open(EnvironmentAccess.layerFixed([access]), local)
    const session = yield* begin(harness, [])
    yield* restart(harness, session.sessionId, [{ environmentId, directory: workspace }])
    const name = `moved-${crypto.randomUUID().slice(0, 8)}.ts`
    yield* Effect.promise(() => Bun.write(join(workspace, "found", name), "export {}\n"))
    const globbed = yield* session.turn(stub.script({ tool: { name: "glob", input: { pattern: "**/moved-*.ts" } } }))
    expect(toolOutput(globbed)).toContain(name)
    const grepped = yield* session.turn(stub.script({ tool: { name: "grep", input: { pattern: "export" } } }))
    expect(toolOutput(grepped)).toContain(name)
  }),
)

it.live("detaches a session from its environment and takes away the file and shell tools", () =>
  Effect.gen(function* () {
    const harness = yield* openServed
    const session = yield* begin(harness)
    yield* restart(harness, session.sessionId, [])
    const call = yield* session.turn(stub.script(), 1)
    expect(call.tools.filter((tool) => fileTools.includes(tool))).toEqual([])
  }),
)

it.live("keeps a session's environment when a later start does not name one", () =>
  Effect.gen(function* () {
    const harness = yield* openServed
    const session = yield* begin(harness)
    yield* harness.start({ sessionId: session.sessionId, harness: "opencode", instructions: {}, interactive: false })
    const file = `${crypto.randomUUID()}.txt`
    yield* session.turn(stub.script(shell(`echo kept > ${file}`)))
    expect(yield* Effect.promise(() => Bun.file(join(workspace, file)).text())).toBe("kept\n")
  }),
)

it.live("refuses a directory the environment does not have, and keeps the session where it was", () =>
  Effect.gen(function* () {
    const harness = yield* openServed
    const session = yield* begin(harness)
    const error = yield* restart(harness, session.sessionId, [
      { environmentId, directory: join(workspace, crypto.randomUUID()) },
    ]).pipe(Effect.flip)
    expect(error._tag).toBe("BrainRejectedError")
    expect(error.message).toContain("does not exist")
    const file = `${crypto.randomUUID()}.txt`
    yield* session.turn(stub.script(shell(`echo stayed > ${file}`)))
    expect(yield* Effect.promise(() => Bun.file(join(workspace, file)).text())).toBe("stayed\n")
  }),
)

it.live(
  "refuses to move a session while its turn runs",
  () =>
    Effect.gen(function* () {
      const harness = yield* openServed
      const session = yield* begin(harness)
      const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
      yield* session.send(stub.script(shell(`echo $$ > ${pidFile}; exec sleep 30`)))
      yield* pidIn(pidFile)
      const error = yield* restart(harness, session.sessionId, []).pipe(Effect.flip)
      expect(error.message).toContain("is running")
      const own = (yield* harness.sessions).find((state) => String(state.id) === session.sessionId)
      if (own) yield* own.interrupt
    }),
  30_000,
)

it.live("runs the next command on a replaced machine as soon as the environment's access changes", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const original = yield* machine(environmentId)
    const replacement = yield* machine(environmentId)
    const context = yield* Layer.build(
      EnvironmentAccess.layerMemory([yield* accessTo(original.url, { brain, lifetimeMs: 600_000 })]),
    )
    const harness = yield* open(Layer.succeedContext(context))
    const session = yield* begin(harness)
    const file = `${crypto.randomUUID()}.txt`
    yield* session.turn(stub.script(shell(`echo old > ${file}`)))
    yield* original.stop
    yield* Context.get(context, EnvironmentAccess.Memory).set(
      yield* accessTo(replacement.url, { brain, lifetimeMs: 600_000, generation: 2 }),
    )
    const answered = yield* session.turn(stub.script(shell(`echo new >> ${file} && echo reached`)))
    expect(toolOutput(answered)).toContain("reached")
    expect(yield* Effect.promise(() => Bun.file(join(workspace, file)).text())).toBe("old\nnew\n")
  }),
)

it.live("keeps running tools after the environment token expires between turns", () =>
  Effect.gen(function* () {
    const url = yield* served
    const brain = Brain.ID.create()
    const harness = yield* open(
      Layer.succeed(
        EnvironmentAccess.Service,
        EnvironmentAccess.Service.of({
          open: () => accessTo(url, { brain, lifetimeMs: 2_000 }),
          subscribe: Effect.succeed(Stream.never),
        }),
      ),
    )
    const session = yield* begin(harness)
    expect(toolOutput(yield* session.turn(stub.script(shell("echo $((20 + 3))"))))).toContain("23")
    yield* Effect.sleep(3_000)
    expect(toolOutput(yield* session.turn(stub.script(shell("echo $((30 + 4))"))))).toContain("34")
  }),
)

it.live("gives the model a command's whole result when the network drops for a moment mid-command", () =>
  Effect.gen(function* () {
    const relay = yield* Relay.make(Relay.portOf(yield* served))
    const access = yield* accessTo(relay.url, { brain: Brain.ID.create(), lifetimeMs: 600_000 })
    const session = yield* begin(yield* open(EnvironmentAccess.layerFixed([access])))
    const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
    const script = stub.script(
      shell(`echo $$ > ${pidFile}; for i in 1 2 3 4; do echo line$i; sleep 0.5; done; echo exit-code-next; exit 3`),
    )
    yield* session.send(script)
    yield* pidIn(pidFile)
    yield* Effect.sleep(700)
    yield* relay.cut
    const result = toolOutput(yield* Effect.promise(() => script.called(2)))
    expect(["line1", "line2", "line3", "line4", "exit-code-next"].filter((line) => !result.includes(line))).toEqual([])
    expect(result).toContain("Exited with code 3")
    expect(result).not.toContain("environment disconnected")
  }),
)

it.skip(
  "ends the turn, telling the model the command did not finish, when the executor dies mid-command",
  () =>
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
      ).pipe(
        Effect.repeat({ until: (status) => status === 401, schedule: Schedule.spaced(100) }),
        Effect.timeout(10_000),
      )
      const access = yield* accessTo(url, { brain: Brain.ID.create(), lifetimeMs: 600_000 })
      const session = yield* begin(yield* open(EnvironmentAccess.layerFixed([access])))
      const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
      const script = stub.script(shell(`echo $$ > ${pidFile}; exec sleep 30`))
      yield* session.send(script)
      const pid = yield* pidIn(pidFile)
      yield* Effect.addFinalizer(() => Effect.ignore(Effect.try(() => process.kill(pid, "SIGKILL"))))
      executor.kill("SIGKILL")
      const answered = yield* Effect.promise(() => script.called(2)).pipe(Effect.timeout(45_000))
      expect(toolOutput(answered)).toContain("environment disconnected")
    }),
  60_000,
)

const noteOf = (call: StubModel.Call) =>
  call.body.messages
    .map((message) => JSON.stringify(message.content ?? ""))
    .reduce<RegExpMatchArray | null>((current, content) => {
      if (content.includes('ren.environment\\\" no longer applies')) return null
      return content.match(/Your file and shell tools run on environment (env_\w+), in ([^.]+)\./) ?? current
    }, null)

const sendTo = (
  harness: Harness.Instance,
  sessionId: Session.ID,
  script: StubModel.Script,
  delivery: Session.Delivery = "steer",
) =>
  harness.send({
    sessionId,
    messageId: Session.MessageID.create(),
    prompt: { text: `${script.marker} use the tool` },
    delivery,
    sender: { userId: "user_1" },
  })

const lastToolResult = (call: StubModel.Call) =>
  JSON.stringify(call.body.messages.findLast((message) => message.role === "tool")?.content ?? "")

const refusedTurn = Effect.fnUntraced(function* (session: {
  readonly turn: (script: StubModel.Script) => Effect.Effect<StubModel.Call, unknown>
}) {
  const marker = join(workspace, `${crypto.randomUUID()}.ran`)
  const result = lastToolResult(yield* session.turn(stub.script(shell(`touch ${marker}`))))
  return { result, ran: yield* Effect.promise(() => Bun.file(marker).exists()) }
})

const withSecondMachine = Effect.gen(function* () {
  const brain = Brain.ID.create()
  const otherId = Environment.ID.create()
  const other = yield* machine(otherId)
  const harness = yield* open(
    EnvironmentAccess.layerFixed([
      yield* accessTo(yield* served, { brain, lifetimeMs: 600_000 }),
      yield* accessTo(other.url, { brain, lifetimeMs: 600_000, environmentId: otherId }),
    ]),
  )
  return {
    harness,
    otherId,
    other,
    here: { environmentId, directory: workspace },
    there: { environmentId: otherId, directory: other.directory },
  }
})

it.live("a new session started on a machine with a first message runs that first turn on the machine", () =>
  Effect.gen(function* () {
    const harness = yield* openServed
    const sessionId = Session.ID.create()
    const file = `${crypto.randomUUID()}.txt`
    const script = stub.script(shell(`echo first > ${file}`))
    yield* harness.start({
      sessionId,
      harness: "opencode",
      instructions: {},
      interactive: false,
      environments: [{ environmentId, directory: workspace }],
      initialMessage: {
        messageId: Session.MessageID.create(),
        prompt: { text: `${script.marker} use the tool` },
        sender: { userId: "user_1" },
      },
    })
    yield* Effect.promise(() => script.called(2))
    expect(yield* Effect.promise(() => Bun.file(join(workspace, file)).text())).toBe("first\n")
  }),
)

it.live("refuses to start a new session on a machine it cannot use, and creates no session", () =>
  Effect.gen(function* () {
    const brain = Brain.ID.create()
    const dead = yield* machine(environmentId)
    yield* dead.stop
    const deadId = Environment.ID.create()
    const harness = yield* open(
      EnvironmentAccess.layerFixed([
        yield* accessTo(yield* served, { brain, lifetimeMs: 600_000 }),
        yield* accessTo(dead.url, { brain, lifetimeMs: 600_000, environmentId: deadId }),
      ]),
    )
    const file = join(workspace, `${crypto.randomUUID()}.txt`)
    yield* Effect.promise(() => Bun.write(file, "a file"))
    const attempts = [
      { environmentId: Environment.ID.create(), directory: workspace },
      { environmentId: deadId, directory: workspace },
      { environmentId, directory: file },
    ]
    const outcomes = yield* Effect.forEach(attempts, (location) =>
      Effect.gen(function* () {
        const sessionId = Session.ID.create()
        const error = yield* harness
          .start({ sessionId, harness: "opencode", instructions: {}, interactive: false, environments: [location] })
          .pipe(Effect.flip)
        const send = yield* sendTo(harness, sessionId, stub.script()).pipe(Effect.flip)
        return [error._tag, send._tag]
      }),
    )
    expect(outcomes).toEqual(Array(3).fill(["BrainRejectedError", "SessionNotStartedError"]))
  }),
)

it.live("a move waits for a running turn that ends within 10 seconds, then the next turn runs on the new machine", () =>
  Effect.gen(function* () {
    const setup = yield* withSecondMachine
    const session = yield* begin(setup.harness)
    const running = stub.script(shell("sleep 2; echo slept"))
    yield* session.send(running)
    yield* Effect.sleep(500)
    yield* restart(setup.harness, session.sessionId, [setup.there])
    expect(toolOutput(yield* Effect.promise(() => running.called(2)))).toContain("slept")
    expect(toolOutput(yield* session.turn(stub.script(shell("pwd"))))).toContain(setup.other.directory)
  }),
)

it.live("a background helper's command finishes where it started, and the helper's next step follows the move", () =>
  Effect.gen(function* () {
    const setup = yield* withSecondMachine
    const session = yield* begin(setup.harness)
    const childFile = `${crypto.randomUUID()}.txt`
    const child = stub.script(shell(`sleep 2; pwd > ${childFile}`))
    const launched = yield* session.turn(
      stub.script({
        tool: {
          name: "subagent",
          input: { agent: "general", description: "Work", prompt: `${child.marker} work`, background: true },
        },
      }),
    )
    const childId = toolOutput(launched).match(/sessionID: (ses_\w+)/)?.[1]
    expect(childId).toBeDefined()
    if (!childId) return
    yield* Effect.promise(() => child.called(1))
    yield* Effect.sleep(300)
    yield* restart(setup.harness, session.sessionId, [setup.there])
    yield* Effect.promise(() => child.called(2))
    expect(yield* Effect.promise(() => Bun.file(join(workspace, childFile)).text())).toBe(`${workspace}\n`)
    const next = stub.script(shell("pwd"))
    yield* sendTo(setup.harness, Session.ID.make(childId), next)
    expect(toolOutput(yield* Effect.promise(() => next.called(2)))).toContain(setup.other.directory)
  }),
)

it.live("a queued turn that starts while a move lands runs its command where the model is told it runs", () =>
  Effect.gen(function* () {
    const setup = yield* withSecondMachine
    const session = yield* begin(setup.harness)
    const running = stub.script(shell("sleep 1"))
    const queued = stub.script(shell("pwd"))
    yield* session.send(running)
    yield* sendTo(setup.harness, Session.ID.make(session.sessionId), queued, "queue")
    yield* Effect.sleep(300)
    yield* Effect.exit(restart(setup.harness, session.sessionId, [setup.there]))
    const call = yield* Effect.promise(() => queued.called(2))
    const told = noteOf(queued.calls.at(0) ?? call)
    expect(told).not.toBeNull()
    expect(toolOutput(call)).toContain(told?.[2] ?? "missing note")
  }),
)

it.live("two starts at once naming different machines leave the session on one, and the model is told that one", () =>
  Effect.gen(function* () {
    const setup = yield* withSecondMachine
    const session = yield* begin(setup.harness)
    yield* Effect.all(
      [
        restart(setup.harness, session.sessionId, [setup.there]),
        restart(setup.harness, session.sessionId, [setup.here]),
      ],
      { concurrency: "unbounded" },
    )
    const call = yield* session.turn(stub.script(shell("pwd")))
    const told = noteOf(call)
    expect(told).not.toBeNull()
    expect(toolOutput(call)).toContain(told?.[2] ?? "missing note")
  }),
)

it.live(
  "detaching drops the note and keeps the no-questions rule; reattaching brings the tools back and keeps it",
  () =>
    Effect.gen(function* () {
      const harness = yield* openServed
      const session = yield* begin(harness)
      yield* restart(harness, session.sessionId, [])
      const detached = yield* session.turn(stub.script(), 1)
      expect(noteOf(detached)).toBeNull()
      expect(detached.tools).not.toContain("question")
      yield* restart(harness, session.sessionId, [{ environmentId, directory: workspace }])
      const attached = yield* session.turn(stub.script(), 1)
      expect(fileTools.filter((tool) => !attached.tools.includes(tool))).toEqual([])
      expect(attached.tools).not.toContain("question")
      expect(noteOf(attached)?.[1]).toBe(environmentId)
    }),
)

it.live("an agent that allows the shell still cannot run it in a session with no machine", () =>
  Effect.gen(function* () {
    const access = yield* accessTo(yield* served, { brain: Brain.ID.create(), lifetimeMs: 600_000 })
    const harness = yield* open(EnvironmentAccess.layerFixed([access]), local)
    const sessionId = Session.ID.create()
    yield* harness.start({
      sessionId,
      harness: "opencode",
      instructions: {},
      interactive: false,
      agent: "explore",
      environments: [],
    })
    const script = stub.script()
    yield* sendTo(harness, sessionId, script)
    const call = yield* Effect.promise(() => script.called(1))
    expect(call.tools.filter((tool) => fileTools.includes(tool))).toEqual([])
  }),
)

it.live("a helper of a session with no machine has no file or shell tools", () =>
  Effect.gen(function* () {
    const access = yield* accessTo(yield* served, { brain: Brain.ID.create(), lifetimeMs: 600_000 })
    const harness = yield* open(EnvironmentAccess.layerFixed([access]), local)
    const session = yield* begin(harness, [])
    const child = stub.script()
    yield* session.turn(
      stub.script({
        tool: { name: "subagent", input: { agent: "general", description: "Look", prompt: `${child.marker} look` } },
      }),
    )
    const call = yield* Effect.promise(() => child.called(1))
    expect(call.tools.filter((tool) => fileTools.includes(tool))).toEqual([])
  }),
)

it.live("after a move to another folder, reading a path that search returned works", () =>
  Effect.gen(function* () {
    const setup = yield* withSecondMachine
    const session = yield* begin(setup.harness)
    yield* restart(setup.harness, session.sessionId, [setup.there])
    const name = `found-${crypto.randomUUID().slice(0, 8)}.md`
    yield* Effect.promise(() => Bun.write(join(setup.other.directory, "docs", name), "found on the other machine\n"))
    const globbed = toolOutput(
      yield* session.turn(stub.script({ tool: { name: "glob", input: { pattern: "**/found-*.md" } } })),
    )
    const path = globbed.match(new RegExp(`[^"\\\\\\s]*${name}`))?.[0]
    expect(path).toBeDefined()
    const read = yield* session
      .turn(stub.script({ tool: { name: "read", input: { path } } }))
      .pipe(Effect.timeout(15_000))
    expect(toolOutput(read)).toContain("found on the other machine")
  }),
)

it.live("moving one session leaves other sessions on the same and on another machine where they were", () =>
  Effect.gen(function* () {
    const setup = yield* withSecondMachine
    const moving = yield* begin(setup.harness)
    const staying = yield* begin(setup.harness)
    const elsewhere = yield* begin(setup.harness, [setup.there])
    yield* restart(setup.harness, moving.sessionId, [setup.there])
    expect(toolOutput(yield* moving.turn(stub.script(shell("pwd"))))).toContain(setup.other.directory)
    expect(toolOutput(yield* staying.turn(stub.script(shell("pwd"))))).toContain(workspace)
    expect(toolOutput(yield* elsewhere.turn(stub.script(shell("pwd"))))).toContain(setup.other.directory)
  }),
)

it.live("the model is told the right machine after each move, folder change, detach and reattach", () =>
  Effect.gen(function* () {
    const setup = yield* withSecondMachine
    const session = yield* begin(setup.harness)
    const sub = join(setup.other.directory, "sub")
    yield* Effect.promise(() => Bun.write(join(sub, ".keep"), ""))
    const steps: ReadonlyArray<ReadonlyArray<Environment.Location>> = [
      [setup.there],
      [{ environmentId: setup.otherId, directory: sub }],
      [],
      [setup.here],
    ]
    const told = yield* Effect.forEach(steps, (step) =>
      restart(setup.harness, session.sessionId, step).pipe(
        Effect.andThen(session.turn(stub.script(), 1)),
        Effect.map((call) => noteOf(call)?.slice(1, 3) ?? null),
      ),
    )
    expect(told).toEqual([
      [setup.otherId, setup.other.directory],
      [setup.otherId, sub],
      null,
      [environmentId, workspace],
    ])
  }),
)

it.live(
  "removing a machine's access lets a running command finish, refuses the next one, and access back restores tools",
  () =>
    Effect.gen(function* () {
      const brain = Brain.ID.create()
      const access = yield* accessTo(yield* served, { brain, lifetimeMs: 600_000 })
      const context = yield* Layer.build(EnvironmentAccess.layerMemory([access]))
      const memory = Context.get(context, EnvironmentAccess.Memory)
      const harness = yield* open(Layer.succeedContext(context))
      const session = yield* begin(harness)
      const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
      const running = stub.script(shell(`echo $$ > ${pidFile}; sleep 2; echo finished`))
      yield* session.send(running)
      yield* pidIn(pidFile)
      yield* memory.remove(environmentId)
      const finished = lastToolResult(yield* Effect.promise(() => running.called(2)))
      const refused = yield* refusedTurn(session)
      yield* memory.set(access)
      const back = lastToolResult(yield* session.turn(stub.script(shell("echo back"))))
      expect({ finished, ran: refused.ran, failed: refused.result.includes("tool.execution"), back }).toEqual({
        finished: JSON.stringify("finished\n"),
        ran: false,
        failed: true,
        back: JSON.stringify("back\n"),
      })
    }),
)

it.live("a tool call fails clearly while the executor is down, and the next one works once it is back", () =>
  Effect.gen(function* () {
    const relay = yield* Relay.make(Relay.portOf(yield* served))
    const access = yield* accessTo(relay.url, { brain: Brain.ID.create(), lifetimeMs: 600_000 })
    const session = yield* begin(yield* open(EnvironmentAccess.layerFixed([access])))
    yield* session.turn(stub.script(shell("echo warm")))
    yield* relay.refuse(true)
    yield* relay.cut
    const down = yield* refusedTurn(session)
    yield* relay.refuse(false)
    const back = lastToolResult(yield* session.turn(stub.script(shell("echo back"))))
    expect({ ran: down.ran, failed: down.result.includes("tool.execution"), back }).toEqual({
      ran: false,
      failed: true,
      back: JSON.stringify("back\n"),
    })
  }),
)

const seeded = (seed: number) => {
  const state = { value: seed >>> 0 }
  return (limit: number) => {
    state.value = (state.value + 0x6d2b79f5) >>> 0
    const mixed = Math.imul(state.value ^ (state.value >>> 15), 1 | state.value)
    const next = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((next ^ (next >>> 14)) >>> 0) % limit
  }
}

type Target = "first" | "second"

const sequence = (seed: number) =>
  Effect.gen(function* () {
    const pick = seeded(seed)
    const brain = Brain.ID.create()
    const otherId = Environment.ID.create()
    const original = yield* machine(environmentId)
    const replacement = yield* machine(environmentId)
    const other = yield* machine(otherId)
    const context = yield* Layer.build(
      EnvironmentAccess.layerMemory([
        yield* accessTo(original.url, { brain, lifetimeMs: 600_000 }),
        yield* accessTo(other.url, { brain, lifetimeMs: 600_000, environmentId: otherId }),
      ]),
    )
    const memory = Context.get(context, EnvironmentAccess.Memory)
    const harness = yield* open(Layer.succeedContext(context), local)
    const session = yield* begin(harness, [])
    const locations = {
      first: { environmentId, directory: original.directory },
      second: { environmentId: otherId, directory: other.directory },
    }
    const model = { bound: "none" as "none" | Target, granted: { first: true, second: true }, replaced: false }
    const log: Array<string> = []
    const violations: Array<string> = []
    const check = (index: number, isHeld: boolean, message: string) => {
      if (!isHeld) violations.push(`${index}: ${message}`)
    }
    const move = Effect.fnUntraced(function* (index: number, target: "none" | Target) {
      const exit = yield* Effect.exit(restart(harness, session.sessionId, target === "none" ? [] : [locations[target]]))
      const expected = target === "none" || model.granted[target]
      log.push(`${index}:start ${target} -> ${Exit.isSuccess(exit) ? "ok" : "refused"}`)
      check(index, Exit.isSuccess(exit) === expected, `start ${target} expected ${expected ? "ok" : "refused"}`)
      if (Exit.isSuccess(exit)) model.bound = target
    })
    const replace = Effect.fnUntraced(function* (index: number) {
      yield* original.stop
      yield* memory.set(yield* accessTo(replacement.url, { brain, lifetimeMs: 600_000, generation: 2 }))
      model.replaced = true
      log.push(`${index}:replace first`)
    })
    const accessFor = (target: Target) => {
      if (target === "second") return accessTo(other.url, { brain, lifetimeMs: 600_000, environmentId: otherId })
      if (model.replaced) return accessTo(replacement.url, { brain, lifetimeMs: 600_000, generation: 2 })
      return accessTo(original.url, { brain, lifetimeMs: 600_000 })
    }
    const toggle = Effect.fnUntraced(function* (index: number, target: Target) {
      if (model.granted[target]) yield* memory.remove(locations[target].environmentId)
      if (!model.granted[target]) yield* memory.set(yield* accessFor(target))
      model.granted[target] = !model.granted[target]
      log.push(`${index}:${model.granted[target] ? "grant" : "revoke"} ${target}`)
      yield* Effect.sleep(50)
    })
    const turn = Effect.fnUntraced(function* (index: number) {
      const marker = `${crypto.randomUUID()}.ran`
      const call = yield* session.turn(stub.script(shell(`touch ${marker} && pwd`)))
      const found = yield* Effect.promise(() =>
        Promise.all(
          [original.directory, other.directory].map((directory) => Bun.file(join(directory, marker)).exists()),
        ),
      )
      const ran = (["first", "second"] as const).filter((_, position) => found[position])
      const expected = model.bound !== "none" && model.granted[model.bound] ? [model.bound] : []
      const told = noteOf(call)?.[1]
      log.push(`${index}:turn bound=${model.bound} ran=${ran.join(",") || "nowhere"}`)
      check(
        index,
        Bun.deepEquals(ran, expected),
        `bound to ${model.bound}, expected ${expected.join(",") || "nowhere"}, ran ${ran.join(",") || "nowhere"}`,
      )
      check(
        index,
        told === (model.bound === "none" ? undefined : locations[model.bound].environmentId),
        `told ${told ?? "nothing"}, bound to ${model.bound}`,
      )
      check(index, model.bound !== "none" || !call.tools.includes("shell"), "shell offered with no machine")
    })
    const step = (index: number) => {
      const choice = pick(7)
      if (choice <= 2) return move(index, (["none", "first", "second"] as const)[choice] ?? "none")
      if (choice === 3 && !model.replaced) return replace(index)
      if (choice === 4) return toggle(index, pick(2) === 0 ? "first" : "second")
      return turn(index)
    }
    yield* Effect.forEach(
      Array.from({ length: 24 }, (_, index) => index),
      step,
      { discard: true },
    )
    return { seed, violations, log }
  })

it.live(
  "random sequences of moves, turns, replacements and access changes keep every invariant",
  () =>
    Effect.gen(function* () {
      const results = yield* Effect.forEach([7, 42, 1234, 2026, 98765], (seed) => Effect.scoped(sequence(seed)))
      expect(results.filter((result) => result.violations.length > 0)).toEqual([])
    }),
  240_000,
)
