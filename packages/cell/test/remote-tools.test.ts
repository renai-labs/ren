import { expect, setDefaultTimeout, test } from "bun:test"
import { AbsolutePath } from "@opencode/client/effect"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { Environments } from "@ren/brain/environments"
import { EnvironmentAccess } from "@ren/brain/environment-access"
import { Machine, Processes, Relay, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Context, Effect, Layer, Ref, Schema, type Scope } from "effect"
import { FetchHttpClient, HttpServer } from "effect/http"
import { mkdtemp, realpath, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Env } from "../src/env.js"
import type { Harness } from "../src/harness/harness.js"
import { OpenCodeHarness } from "../src/harness/opencode/harness.js"
import { Host } from "../src/harness/opencode/host.js"
import { RenWorkspaceDriver } from "../src/harness/opencode/ren-workspace-driver.js"
import { Pid } from "./lib/pid.js"
import { Shared } from "./lib/shared.js"
import type { StubModel } from "./lib/stub-model.js"

setDefaultTimeout(30_000)

const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-environment-")))
const local = await realpath(await mkdtemp(join(tmpdir(), "ren-local-")))
const stub = Shared.stub()
const fileTools = ["read", "write", "edit", "glob", "grep", "shell"]

const served = Machine.layer({ environmentId, workspace })

const it = testEffect(served)

const live = <A, E>(body: Effect.Effect<A, E, Layer.Success<typeof served> | Scope.Scope>) =>
  body.pipe(Effect.scoped, Effect.provide(served), Effect.runPromise)

const folder = (sessionId: Session.ID) => join(workspace, sessionId)

const accessTo = (url: string, sessionId: Session.ID) =>
  Machine.access({ url, environmentId, brain: Brain.ofSession(sessionId), directory: folder(sessionId) })

const open = Effect.fnUntraced(function* () {
  const context = yield* Layer.build(EnvironmentAccess.layerMemory(new Map()))
  const memory = Context.get(context, EnvironmentAccess.Memory)
  const opens = yield* Ref.make(0)
  const counted = Layer.succeed(
    EnvironmentAccess.Service,
    EnvironmentAccess.Service.of({
      open: (sessionId) =>
        Ref.update(opens, (count) => count + 1).pipe(
          Effect.andThen(Context.get(context, EnvironmentAccess.Service).open(sessionId)),
        ),
      subscribe: Context.get(context, EnvironmentAccess.Service).subscribe,
    }),
  )
  const environments = Context.get(
    yield* Layer.build(Environments.layer.pipe(Layer.provide(counted), Layer.provide(FetchHttpClient.layer))),
    Environments.Service,
  )
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
      RenWorkspaceDriver.replacements(environments),
    ).pipe(Layer.provide(HttpServer.layerServices)),
    endpoints,
    () => Effect.succeedNone,
    true,
  )
  return {
    harness: yield* OpenCodeHarness.make(host, endpoints, AbsolutePath.make(local)),
    memory,
    opens: Ref.get(opens),
  }
})

type Opened = Effect.Success<ReturnType<typeof open>>

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

const restart = (
  harness: Harness.Instance,
  sessionId: Session.ID,
  environment?: Environment.Location,
  agent?: string,
  initialMessage?: Session.StartInput["initialMessage"],
) =>
  harness.start({
    sessionId,
    harness: "opencode",
    instructions: {},
    interactive: false,
    ...(environment && { environment }),
    ...(agent && { agent }),
    ...(initialMessage && { initialMessage }),
  })

const locationOf = (sessionId: Session.ID) => ({ environmentId, directory: Environment.sessionDirectory(sessionId) })

const begin = Effect.fnUntraced(function* (
  opened: Opened,
  options: { readonly onEnvironment?: boolean; readonly agent?: string; readonly url?: string } = {},
) {
  const sessionId = Session.ID.create()
  const onEnvironment = options.onEnvironment ?? true
  if (onEnvironment) yield* opened.memory.set(sessionId, yield* accessTo(options.url ?? (yield* Machine.url), sessionId))
  yield* restart(opened.harness, sessionId, onEnvironment ? locationOf(sessionId) : undefined, options.agent)
  const send = (script: StubModel.Script) => sendTo(opened.harness, sessionId, script)
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

const lastToolResult = (call: StubModel.Call) =>
  JSON.stringify(call.body.messages.findLast((message) => message.role === "tool")?.content ?? "")

const shell = (command: string) => ({ tool: { name: "shell", input: { command } } })

const text = (path: string) => Effect.promise(() => Bun.file(path).text())

const refusedTurn = Effect.fnUntraced(function* (
  session: { readonly sessionId: Session.ID; readonly turn: (script: StubModel.Script) => Effect.Effect<StubModel.Call, unknown> },
) {
  const marker = join(workspace, `${crypto.randomUUID()}.ran`)
  const result = lastToolResult(yield* session.turn(stub.script(shell(`touch ${marker}`))))
  return { result, ran: yield* Effect.promise(() => Bun.file(marker).exists()) }
})

const marker = crypto.randomUUID()

test.each<
  [
    string,
    { readonly name: string; readonly input: unknown },
    Readonly<Record<string, string>>,
    ReadonlyArray<string>,
    Readonly<Record<string, string>>,
  ]
>([
  ["shell", { name: "shell", input: { command: `echo ${marker} > shell.txt && ls && pwd` } }, {}, ["shell.txt"], { "shell.txt": `${marker}\n` }],
  ["read", { name: "read", input: { path: "notes.md" } }, { "notes.md": `remote ${marker}\n` }, [marker], {}],
  [
    "grep",
    { name: "grep", input: { pattern: `needle${marker.slice(0, 8)}` } },
    { "src/found.ts": `export const needle${marker.slice(0, 8)} = 1\n` },
    ["found.ts"],
    {},
  ],
  [
    "write",
    { name: "write", input: { path: "written.txt", content: `written ${marker}\n` } },
    {},
    [],
    { "written.txt": `written ${marker}\n` },
  ],
  [
    "edit",
    { name: "edit", input: { path: "edited.txt", oldString: "before", newString: "after" } },
    { "edited.txt": "before edit\n" },
    [],
    { "edited.txt": "after edit\n" },
  ],
  [
    "glob",
    { name: "glob", input: { pattern: `**/globbed-${marker.slice(0, 8)}.ts` } },
    { [`deep/er/globbed-${marker.slice(0, 8)}.ts`]: "export {}\n" },
    [`globbed-${marker.slice(0, 8)}.ts`],
    {},
  ],
])("runs the %s tool on the session's sandbox, in the session's folder", (_name, tool, before, output, after) =>
  live(
    Effect.gen(function* () {
      const opened = yield* open()
      const session = yield* begin(opened)
      yield* Effect.forEach(Object.entries(before), (entry) =>
        Effect.promise(() => Bun.write(join(folder(session.sessionId), entry[0]), entry[1])),
      )
      const result = toolOutput(yield* session.turn(stub.script({ tool })))
      expect(output.filter((part) => !result.includes(part))).toEqual([])
      expect(
        yield* Effect.forEach(Object.keys(after), (path) => text(join(folder(session.sessionId), path))),
      ).toEqual(Object.values(after))
    }),
  ),
)

it.live("a start and a turn with no file or shell call contact neither Ren nor the sandbox; the first file call does", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const session = yield* begin(opened)
    yield* session.turn(stub.script(), 1)
    expect(yield* opened.opens).toBe(0)
    expect((yield* Effect.promise(() => stat(folder(session.sessionId)).catch(() => undefined))) === undefined).toBe(
      true,
    )
    yield* session.turn(stub.script(shell("pwd")))
    expect(yield* opened.opens).toBe(1)
    expect((yield* Effect.promise(() => stat(folder(session.sessionId)))).isDirectory()).toBe(true)
    yield* session.turn(stub.script(shell("pwd")))
    expect(yield* opened.opens).toBe(1)
  }),
)

it.live("two sessions on one sandbox work in their own folders", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const first = yield* begin(opened)
    const second = yield* begin(opened)
    yield* first.turn(stub.script(shell("echo first > mine.txt")))
    const listed = toolOutput(yield* second.turn(stub.script(shell("ls; pwd"))))
    expect(listed).toContain(folder(second.sessionId))
    expect(listed).not.toContain("mine.txt")
    expect(yield* text(join(folder(first.sessionId), "mine.txt"))).toBe("first\n")
  }),
)

it.live("runs a subagent's tools on its parent session's sandbox", () =>
  Effect.gen(function* () {
    const file = `${crypto.randomUUID()}.txt`
    const child = stub.script(shell(`echo $((40 + 2)) > ${file}`))
    const opened = yield* open()
    const session = yield* begin(opened)
    yield* session.turn(
      stub.script({
        tool: {
          name: "subagent",
          input: { agent: "general", description: "Write a file", prompt: `${child.marker} write it` },
        },
      }),
    )
    expect(child.calls.length).toBeGreaterThanOrEqual(2)
    expect(yield* text(join(folder(session.sessionId), file))).toBe("42\n")
  }),
)

it.live("interrupting a turn kills its command on the sandbox", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const session = yield* begin(opened)
    const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
    yield* session.send(stub.script(shell(`echo $$ > ${pidFile}; exec sleep 60`)))
    const pid = yield* Pid.read(pidFile)
    const own = (yield* opened.harness.sessions).find((state) => String(state.id) === session.sessionId)
    expect(own).toBeDefined()
    if (!own) return
    yield* own.interrupt
    expect(yield* Processes.exits(pid)).toBe(true)
  }),
)

test.each<[string, boolean, string | undefined]>([
  ["on an environment", true, undefined],
  ["without an environment", false, undefined],
  ["without an environment, under an agent that allows the shell", false, "explore"],
])(
  "a session %s gets the file and shell tools only with an environment, keeps the other tools, and never questions",
  (_name, onEnvironment, agent) =>
    live(
      Effect.gen(function* () {
        const opened = yield* open()
        const session = yield* begin(opened, { onEnvironment, ...(agent && { agent }) })
        const call = yield* session.turn(stub.script(), 1)
        expect(fileTools.filter((tool) => call.tools.includes(tool))).toEqual(onEnvironment ? fileTools : [])
        expect(call.tools).toContain("webfetch")
        expect(call.tools).not.toContain("question")
        expect(JSON.stringify(call.body.messages)).toContain(
          onEnvironment ? "Your file and shell tools run on a sandbox" : "This session has no environment",
        )
      }),
    ),
)

it.live("keeps a session's environment when a later start does not name one", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const session = yield* begin(opened)
    yield* restart(opened.harness, session.sessionId)
    yield* restart(opened.harness, session.sessionId, locationOf(session.sessionId))
    yield* session.turn(stub.script(shell("echo kept > kept.txt")))
    expect(yield* text(join(folder(session.sessionId), "kept.txt"))).toBe("kept\n")
  }),
)

it.live("refuses an environment for a session that started without one, or a folder other than its own", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const session = yield* begin(opened, { onEnvironment: false })
    const later = yield* restart(opened.harness, session.sessionId, locationOf(session.sessionId)).pipe(Effect.flip)
    expect(later.message).toBe(`Session ${session.sessionId} cannot change its environment: not supported yet`)
    const call = yield* session.turn(stub.script(), 1)
    expect(fileTools.filter((tool) => call.tools.includes(tool))).toEqual([])
    const elsewhere = Session.ID.create()
    const wrong = yield* restart(opened.harness, elsewhere, { environmentId, directory: "/workspace" }).pipe(
      Effect.flip,
    )
    expect(wrong.message).toBe(`Session ${elsewhere} works in /workspace/${elsewhere} on its sandbox, not /workspace`)
    expect((yield* sendTo(opened.harness, elsewhere, stub.script()).pipe(Effect.flip))._tag).toBe(
      "SessionNotStartedError",
    )
  }),
)

it.live("the same start twice makes one session", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const sessionId = Session.ID.create()
    yield* opened.memory.set(sessionId, yield* accessTo(yield* Machine.url, sessionId))
    yield* Effect.all([restart(opened.harness, sessionId, locationOf(sessionId)), restart(opened.harness, sessionId, locationOf(sessionId))], {
      concurrency: "unbounded",
    })
    const roots = yield* opened.harness.sessions
    expect(roots.filter((state) => String(state.id) === sessionId).length).toBe(1)
  }),
)

it.live("a new session started with a first message runs that first turn on the sandbox", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const sessionId = Session.ID.create()
    yield* opened.memory.set(sessionId, yield* accessTo(yield* Machine.url, sessionId))
    const script = stub.script(shell("echo first > first.txt"))
    yield* restart(opened.harness, sessionId, locationOf(sessionId), undefined, {
      messageId: Session.MessageID.create(),
      prompt: { text: `${script.marker} use the tool` },
      sender: { userId: "user_1" },
    })
    yield* Effect.promise(() => script.called(2))
    expect(yield* text(join(folder(sessionId), "first.txt"))).toBe("first\n")
  }),
)

it.live(
  "a sandbox that cannot be used does not stop the start; the first tool call fails with the cause, and contacts the sandbox once",
  () =>
    Effect.gen(function* () {
      const opened = yield* open()
      const dead = yield* begin(opened, { url: "http://127.0.0.1:9" })
      const deadTurn = yield* refusedTurn(dead)
      expect([deadTurn.ran, deadTurn.result]).toEqual([false, expect.stringContaining("does not answer")])
      const fileSession = Session.ID.create()
      yield* Effect.promise(() => Bun.write(folder(fileSession), "a file, not a folder"))
      yield* opened.memory.set(fileSession, yield* accessTo(yield* Machine.url, fileSession))
      yield* restart(opened.harness, fileSession, locationOf(fileSession))
      const fileTurn = yield* refusedTurn({
        sessionId: fileSession,
        turn: (script) =>
          sendTo(opened.harness, fileSession, script).pipe(Effect.andThen(Effect.promise(() => script.called(2)))),
      })
      expect([fileTurn.ran, fileTurn.result]).toEqual([false, expect.stringContaining("Could not make the folder")])
      const missing = Session.ID.create()
      yield* restart(opened.harness, missing, locationOf(missing))
      const missingTurn = yield* refusedTurn({
        sessionId: missing,
        turn: (script) =>
          sendTo(opened.harness, missing, script).pipe(Effect.andThen(Effect.promise(() => script.called(2)))),
      })
      expect([missingTurn.ran, missingTurn.result]).toEqual([false, expect.stringContaining("No access to a sandbox")])
    }),
)

it.live("a helper of a session with no environment has no file or shell tools", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const session = yield* begin(opened, { onEnvironment: false })
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

it.live(
  "removing a session's access lets a running command finish, fails the next call with no access, and access back restores tools",
  () =>
    Effect.gen(function* () {
      const opened = yield* open()
      const session = yield* begin(opened)
      const access = yield* accessTo(yield* Machine.url, session.sessionId)
      const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
      const running = stub.script(shell(`echo $$ > ${pidFile}; sleep 2; echo finished`))
      yield* session.send(running)
      yield* Pid.read(pidFile)
      yield* opened.memory.remove(session.sessionId)
      const finished = lastToolResult(yield* Effect.promise(() => running.called(2)))
      const refused = yield* refusedTurn(session)
      yield* opened.memory.set(session.sessionId, access)
      const back = lastToolResult(yield* session.turn(stub.script(shell("echo back"))))
      expect({ finished, ran: refused.ran, noAccess: refused.result.includes("No access to a sandbox"), back }).toEqual({
        finished: JSON.stringify("finished\n"),
        ran: false,
        noAccess: true,
        back: JSON.stringify("back\n"),
      })
    }),
)

it.live("a tool call fails clearly while the sandbox is down, and the next one works once it is back", () =>
  Effect.gen(function* () {
    const relay = yield* Relay.make(Relay.portOf(yield* Machine.url))
    const opened = yield* open()
    const session = yield* begin(opened, { url: relay.url })
    yield* session.turn(stub.script(shell("echo warm")))
    yield* relay.refuse(true)
    yield* relay.cut
    const down = yield* refusedTurn(session)
    yield* relay.refuse(false)
    const back = lastToolResult(yield* session.turn(stub.script(shell("echo back"))))
    expect({ ran: down.ran, unreachable: down.result.includes("does not answer"), back }).toEqual({
      ran: false,
      unreachable: true,
      back: JSON.stringify("back\n"),
    })
    expect(yield* opened.opens).toBe(2)
  }),
)

test.todo("Q2 the model reads the full output of a long command at the path that OpenCode names", () =>
  live(
    Effect.gen(function* () {
      const opened = yield* open()
      const session = yield* begin(opened)
      const call = yield* session.turn(stub.script(shell("seq 1 30000")))
      const path = toolOutput(call).match(/full output saved to ([^\]"]+)/)?.[1]
      expect(path).toBeDefined()
      const read = toolOutput(yield* session.turn(stub.script({ tool: { name: "read", input: { path } } })))
      expect(read).toContain("15000")
    }),
  ),
)
