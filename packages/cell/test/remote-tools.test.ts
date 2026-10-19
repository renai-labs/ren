import { expect, setDefaultTimeout, test } from "bun:test"
import { TestAccess } from "@ren/brain/testing"
import { AbsolutePath, OpenCode, SessionMessage } from "@opencode/client/effect"
import { SessionID } from "@opencode/schema/session-id"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { Environments } from "@ren/brain/environments"
import { EnvironmentAccess } from "@ren/brain/environment-access"
import { Machine, Processes, Relay, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Shell } from "@ren/schema/shell"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Option, Ref, Schedule, Schema, Scope, Stream } from "effect"
import { FetchHttpClient, HttpServer } from "effect/http"
import { mkdtemp, realpath, stat } from "node:fs/promises"
import { createServer, type Socket } from "node:net"
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

const open = Effect.fnUntraced(function* (beforeOpen: Effect.Effect<void> = Effect.void) {
  const context = yield* Layer.build(TestAccess.memory(new Map()))
  const memory = Context.get(context, TestAccess.Memory)
  const opens = yield* Ref.make(0)
  const counted = Layer.succeed(
    EnvironmentAccess.Service,
    EnvironmentAccess.Service.of({
      open: (sessionId) =>
        Ref.update(opens, (count) => count + 1).pipe(
          Effect.andThen(beforeOpen),
          Effect.andThen(Context.get(context, EnvironmentAccess.Service).open(sessionId)),
        ),
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
    host,
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

const locationOf = (sessionId: Session.ID, capabilities?: ReadonlyArray<Environment.Capability>) => ({
  environmentId,
  directory: Environment.sessionDirectory(sessionId),
  ...(capabilities && { capabilities }),
})

const begin = Effect.fnUntraced(function* (
  opened: Opened,
  options: {
    readonly onEnvironment?: boolean
    readonly agent?: string
    readonly url?: string
    readonly capabilities?: ReadonlyArray<Environment.Capability>
  } = {},
) {
  const sessionId = Session.ID.create()
  const onEnvironment = options.onEnvironment ?? true
  if (onEnvironment)
    yield* opened.memory.set(sessionId, yield* accessTo(options.url ?? (yield* Machine.url), sessionId))
  yield* restart(
    opened.harness,
    sessionId,
    onEnvironment ? locationOf(sessionId, options.capabilities) : undefined,
    options.agent,
  )
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

const ShellID = Schema.Struct({ shellID: Shell.ID })

const text = (path: string) => Effect.promise(() => Bun.file(path).text())

const refusedTurn = Effect.fnUntraced(function* (session: {
  readonly sessionId: Session.ID
  readonly turn: (script: StubModel.Script) => Effect.Effect<StubModel.Call, unknown>
}) {
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
  [
    "shell",
    { name: "shell", input: { command: `echo ${marker} > shell.txt && ls && pwd` } },
    {},
    ["shell.txt"],
    { "shell.txt": `${marker}\n` },
  ],
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
      expect(yield* Effect.forEach(Object.keys(after), (path) => text(join(folder(session.sessionId), path)))).toEqual(
        Object.values(after),
      )
    }),
  ),
)

it.live(
  "a start and a turn with no file or shell call contact neither Ren nor the sandbox; the first file call does",
  () =>
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

test.each<[string, Array<Environment.Capability>, Array<string>, string]>([
  ["files only", ["files"], ["read", "write", "edit", "glob", "grep"], "runs no commands, so the shell tool is off"],
  ["commands only", ["processes"], ["shell"], "gives no file access, so the read, write, edit"],
])(
  "a sandbox with %s gets only its tools, also after a later start that names no environment",
  (_name, capabilities, offered, note) =>
    live(
      Effect.gen(function* () {
        const opened = yield* open()
        const session = yield* begin(opened, { capabilities })
        const first = yield* session.turn(stub.script(), 1)
        yield* restart(opened.harness, session.sessionId)
        const later = yield* session.turn(stub.script(), 1)
        expect([first, later].map((call) => fileTools.filter((tool) => call.tools.includes(tool)))).toEqual([
          offered,
          offered,
        ])
        expect(JSON.stringify(later.body.messages)).toContain(note)
        expect(yield* opened.opens).toBe(0)
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
    yield* Effect.all(
      [
        restart(opened.harness, sessionId, locationOf(sessionId)),
        restart(opened.harness, sessionId, locationOf(sessionId)),
      ],
      {
        concurrency: "unbounded",
      },
    )
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

it.live("a long command's notice names its last lines and a file on the sandbox that has the full output", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const session = yield* begin(opened)
    const result = lastToolResult(yield* session.turn(stub.script(shell("seq 1 30000"))))
    const file = /full output saved to ([^\]\\]+)\]/.exec(result)?.[1] ?? ""
    expect(result).toContain("[showing lines 28001-30000 of 30000; full output saved to ")
    const saved = yield* text(file)
    expect([saved.split("\n").length - 1, saved.endsWith("29999\n30000\n")]).toEqual([30000, true])
  }),
)

it.live("a background command's output file on the sandbox grows while the command runs", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const session = yield* begin(opened)
    const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
    const job = stub.script({
      tool: { name: "shell", input: { command: `echo $$ > ${pidFile}; echo first; exec sleep 30`, background: true } },
    })
    const result = lastToolResult(yield* session.turn(job))
    const file = /Output is streaming to: ([^\]\\"]+)/.exec(result)?.[1] ?? ""
    const pid = yield* Pid.read(pidFile)
    yield* text(file).pipe(
      Effect.repeat({ until: (written) => written === "first\n", schedule: Schedule.spaced(100) }),
      Effect.timeout("10 seconds"),
      Effect.ensuring(Effect.sync(() => Processes.running(pid) && process.kill(pid, "SIGKILL"))),
    )
  }),
)

it.live("the Chat API lists the shells that still run, reads a shell's output from a cursor, and stops one", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const session = yield* begin(opened)
    const chat = opened.harness.chat
    const shellIDs = chat.messages(session.sessionId, {}).pipe(
      Effect.map((page) =>
        page.items
          .flatMap((message) => (message.type === "assistant" ? message.content : []))
          .flatMap((part) => (part.type === "tool" && part.state.status === "completed" ? [part.state.metadata] : []))
          .flatMap((metadata) => Option.toArray(Schema.decodeUnknownOption(ShellID)(metadata)))
          .map((found) => found.shellID),
      ),
    )
    expect(yield* chat.shells(session.sessionId)).toEqual([])
    const notified = yield* chat.events.pipe(
      Stream.filter((event) => event.type === "session.inbox.enqueued" && event.data.item.type === "synthetic"),
      Stream.runHead,
      Effect.forkScoped,
    )
    yield* session.turn(
      stub.script({ tool: { name: "shell", input: { command: "printf 'hello world'", background: true } } }),
    )
    yield* Fiber.join(notified)
    const [printed] = yield* shellIDs
    if (!printed) return yield* Effect.die(new Error("The shell tool reported no shell"))
    expect(yield* chat.shells(session.sessionId)).toEqual([])
    expect(yield* chat.shellOutput(session.sessionId, printed, {})).toEqual({
      output: "hello world",
      cursor: 11,
      size: 11,
      truncated: false,
    })
    expect(yield* chat.shellOutput(session.sessionId, printed, { cursor: 6 })).toMatchObject({
      output: "world",
      cursor: 11,
    })

    const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
    yield* session.turn(
      stub.script({
        tool: { name: "shell", input: { command: `echo $$ > ${pidFile}; exec sleep 30`, background: true } },
      }),
    )
    const pid = yield* Pid.read(pidFile)
    yield* Effect.addFinalizer(() => Effect.sync(() => Processes.running(pid) && process.kill(pid, "SIGKILL")))
    const sleeping = (yield* shellIDs).find((id) => id !== printed)
    if (!sleeping) return yield* Effect.die(new Error("The shell tool reported no second shell"))
    expect(yield* chat.shells(session.sessionId)).toMatchObject([
      { id: sleeping, sessionID: session.sessionId, status: "running", command: `echo $$ > ${pidFile}; exec sleep 30` },
    ])
    yield* chat.removeShell(session.sessionId, sleeping)
    expect(yield* chat.shells(session.sessionId)).toEqual([])
    expect((yield* chat.shellOutput(session.sessionId, sleeping, {}).pipe(Effect.flip))._tag).toBe("Harness.NotFound")
    expect((yield* chat.shells(Session.ID.create()).pipe(Effect.flip))._tag).toBe("Harness.NotFound")
  }),
)

it.live(
  "a client cannot run a command in the cell: the shell refuses a location without a sandbox, and nothing runs",
  () =>
    Effect.gen(function* () {
      const opened = yield* open()
      const client = yield* OpenCode.make({ baseUrl: "http://opencode" }).pipe(
        Effect.provide(Layer.fresh(FetchHttpClient.layer)),
        Effect.provideService(
          FetchHttpClient.Fetch,
          Object.assign(
            (input: string | URL | Request, init?: RequestInit) =>
              opened.host.fetch(new Request(input instanceof Request ? input.url : String(input), init)),
            { preconnect: fetch.preconnect },
          ),
        ),
      )
      const marker = join(workspace, `${crypto.randomUUID()}.ran`)
      expect((yield* client.shell.create({ command: `touch ${marker}` }).pipe(Effect.flip))._tag).toBe("ClientError")
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
    }),
)

it.live("V1 a note written to the session while a tool call runs reaches the model at the next step of the turn", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const session = yield* begin(opened)
    const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
    const note = `note-${crypto.randomUUID()}`
    const script = stub.script(shell(`echo $$ > ${pidFile}; sleep 2; echo done`))
    yield* session.send(script)
    yield* Pid.read(pidFile)
    yield* opened.host.sessions.synthetic({
      sessionID: SessionID.make(session.sessionId),
      text: note,
      resume: false,
    })
    // oxlint-disable-next-line ren/no-comments -- The note is the newest user message, so the stub cannot match this call to the script by its marker.
    const next = yield* Effect.promise(() => stub.waitFor((call) => JSON.stringify(call.body.messages).includes(note)))
    expect(lastToolResult(next)).toBe(JSON.stringify("done\n"))
  }),
)

// oxlint-disable-next-line ren/no-comments -- OpenCode's snapshots track the cell's folder, not the sandbox, so a revert sees no file changes (D51 defers it).
it.live("V3 a revert with files to a turn that changed a file on the sandbox lists no files and leaves the file", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const session = yield* begin(opened)
    const file = join(workspace, `${crypto.randomUUID()}.txt`)
    const first = stub.script({ tool: { name: "write", input: { path: file, content: "one\n" } } })
    yield* session.send(first)
    yield* Effect.promise(() => first.called(2))
    const second = stub.script({ tool: { name: "write", input: { path: file, content: "two\n" } } })
    const sent = yield* session.send(second)
    yield* Effect.promise(() => second.called(2))
    const staged = yield* opened.host.sessions.revert
      .stage({
        sessionID: SessionID.make(session.sessionId),
        messageID: SessionMessage.ID.make(sent.messageId),
        files: true,
      })
      .pipe(Effect.retry({ schedule: Schedule.spaced(250), times: 40 }))
    expect([staged.files, yield* text(file)]).toEqual([[], "two\n"])
  }),
)

it.live("V2 the execute.after hook runs for a subagent's tool call: its failed shell call names the cause", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const session = yield* begin(opened)
    yield* opened.memory.remove(session.sessionId)
    const child = stub.script(shell("echo child"))
    yield* session.turn(
      stub.script({
        tool: {
          name: "subagent",
          input: { agent: "general", description: "Run it", prompt: `${child.marker} run it` },
        },
      }),
    )
    expect(lastToolResult(yield* Effect.promise(() => child.called(2)))).toContain("No access to a sandbox")
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
  "removing a session's access lets a running command finish, fails a call with no access once the token is due for refresh, and access back restores tools",
  () =>
    Effect.gen(function* () {
      const opened = yield* open()
      const session = yield* begin(opened)
      const access = yield* accessTo(yield* Machine.url, session.sessionId)
      yield* opened.memory.set(
        session.sessionId,
        yield* Machine.access({
          url: yield* Machine.url,
          environmentId,
          brain: Brain.ofSession(session.sessionId),
          directory: folder(session.sessionId),
          lifetimeMs: 6_000,
        }),
      )
      const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
      const running = stub.script(shell(`echo $$ > ${pidFile}; sleep 2; echo finished`))
      yield* session.send(running)
      yield* Pid.read(pidFile)
      yield* opened.memory.remove(session.sessionId)
      const finished = lastToolResult(yield* Effect.promise(() => running.called(2)))
      const refused = yield* refusedTurn(session).pipe(
        Effect.repeat({
          until: (attempt) => attempt.result.includes("No access to a sandbox"),
          schedule: Schedule.spaced(500),
        }),
        Effect.timeout("15 seconds"),
      )
      yield* opened.memory.set(session.sessionId, access)
      const back = lastToolResult(yield* session.turn(stub.script(shell("echo back"))))
      expect({ finished, ran: refused.ran, noAccess: refused.result.includes("No access to a sandbox"), back }).toEqual(
        {
          finished: JSON.stringify("finished\n"),
          ran: false,
          noAccess: true,
          back: JSON.stringify("back\n"),
        },
      )
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

const frozenSandbox = Effect.gen(function* () {
  const machinePort = Relay.portOf(yield* Machine.url)
  const relay = yield* Relay.make(machinePort)
  const sockets = new Set<Socket>()
  const hole = yield* Effect.acquireRelease(
    Effect.promise(async () => {
      const server = createServer((socket) => sockets.add(socket))
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      return server
    }),
    (server) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            for (const socket of sockets) socket.destroy()
            server.close(() => resolve())
          }),
      ),
  )
  const address = hole.address()
  const holePort = typeof address === "object" && address !== null ? address.port : 0
  return {
    url: relay.url,
    freeze: relay.freeze.pipe(Effect.andThen(relay.target(holePort))),
    thaw: relay.target(machinePort),
  }
})

const idle = (opened: Opened, sessionId: Session.ID) =>
  opened.harness.sessions.pipe(
    Effect.map((states) => states.find((state) => String(state.id) === sessionId)?.active === false),
  )

it.live("closing the host while a tool call waits for access completes, and the tool call ends", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const ended = yield* Deferred.make<void>()
    const scope = yield* Scope.make()
    const opened = yield* open(
      Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() => Deferred.succeed(ended, undefined)),
      ),
    ).pipe(Scope.provide(scope))
    const session = yield* begin(opened)
    yield* session.send(stub.script(shell("pwd")))
    yield* Deferred.await(entered)
    yield* Scope.close(scope, Exit.void).pipe(Effect.timeout("15 seconds"))
    yield* Deferred.await(ended).pipe(Effect.timeout("5 seconds"))
  }),
)

// oxlint-disable-next-line ren/no-comments -- OpenCode runs a command in a detached fiber, so a host close leaves it to the executor's 30 second heartbeat rule (accepted for v1).
it.live(
  "a command that runs when the host closes stops on the sandbox within 35 seconds, when its heartbeats stop",
  () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const opened = yield* open().pipe(Scope.provide(scope))
      const session = yield* begin(opened)
      const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
      yield* session.send(stub.script(shell(`echo $$ > ${pidFile}; exec sleep 120`)))
      const pid = yield* Pid.read(pidFile)
      const closedAt = performance.now()
      yield* Scope.close(scope, Exit.void).pipe(Effect.timeout("15 seconds"))
      yield* Effect.sync(() => Processes.running(pid)).pipe(
        Effect.repeat({ until: (running) => !running, schedule: Schedule.spaced(250) }),
        Effect.timeout("40 seconds"),
        Effect.ensuring(Effect.sync(() => Processes.running(pid) && process.kill(pid, "SIGKILL"))),
      )
      expect(performance.now() - closedAt).toBeLessThan(35_000)
    }),
  60_000,
)

it.live(
  "a start for a new session on a frozen sandbox succeeds at once, and a turn of another session is not blocked",
  () =>
    Effect.gen(function* () {
      const opened = yield* open()
      const frozen = yield* frozenSandbox
      yield* frozen.freeze
      yield* begin(opened, { url: frozen.url }).pipe(Effect.timeout("5 seconds"))
      expect(yield* opened.opens).toBe(0)
      const other = yield* begin(opened)
      const result = lastToolResult(yield* other.turn(stub.script(shell("echo ok"))))
      expect([result, yield* opened.opens]).toEqual([JSON.stringify("ok\n"), 1])
    }),
)

it.live("an interrupt during a command on a frozen sandbox ends in the kill's limit and leaves the session idle", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const frozen = yield* frozenSandbox
    const session = yield* begin(opened, { url: frozen.url })
    const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
    yield* session.send(stub.script(shell(`echo $$ > ${pidFile}; exec sleep 60`)))
    const pid = yield* Pid.read(pidFile)
    yield* frozen.freeze
    const own = (yield* opened.harness.sessions).find((state) => String(state.id) === session.sessionId)
    expect(own).toBeDefined()
    if (!own) return
    const startedAt = performance.now()
    yield* own.interrupt.pipe(
      Effect.andThen(own.wait(12_000)),
      Effect.ensuring(Effect.sync(() => void Bun.spawnSync(["kill", "-9", String(pid)]))),
    )
    expect(performance.now() - startedAt).toBeLessThan(10_000)
    expect(yield* idle(opened, session.sessionId)).toBe(true)
  }),
)

it.live("closing the host during a command on a frozen sandbox completes in its limit, and a later turn works", () =>
  Effect.gen(function* () {
    const frozen = yield* frozenSandbox
    const scope = yield* Scope.make()
    const first = yield* open().pipe(Scope.provide(scope))
    const session = yield* begin(first, { url: frozen.url })
    const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
    yield* session.send(stub.script(shell(`echo $$ > ${pidFile}; exec sleep 60`)))
    const pid = yield* Pid.read(pidFile)
    yield* frozen.freeze
    const startedAt = performance.now()
    yield* Scope.close(scope, Exit.void).pipe(
      Effect.timeout("12 seconds"),
      Effect.ensuring(Effect.sync(() => void Bun.spawnSync(["kill", "-9", String(pid)]))),
    )
    expect(performance.now() - startedAt).toBeLessThan(10_000)
    yield* frozen.thaw
    const second = yield* open()
    const later = yield* begin(second, { url: frozen.url })
    expect(lastToolResult(yield* later.turn(stub.script(shell("echo back"))))).toBe(JSON.stringify("back\n"))
  }),
)

it.live("a command that leaves a child holding stdout returns in the time of the local shell", () =>
  Effect.gen(function* () {
    const command = (pidFile: string) => `sleep 5 & echo $! > ${pidFile}; echo done`
    const localPid = join(workspace, `${crypto.randomUUID()}.pid`)
    const localStart = performance.now()
    yield* Effect.promise(async () => {
      const local = Bun.spawn(["sh", "-c", command(localPid)], { stdout: "pipe" })
      await Promise.all([new Response(local.stdout).text(), local.exited])
    })
    const localMs = performance.now() - localStart
    const opened = yield* open()
    const session = yield* begin(opened)
    const remotePid = join(workspace, `${crypto.randomUUID()}.pid`)
    const remoteStart = performance.now()
    const result = lastToolResult(yield* session.turn(stub.script(shell(command(remotePid)))))
    const remoteMs = performance.now() - remoteStart
    expect(result).toContain("done")
    expect(Math.abs(remoteMs - localMs)).toBeLessThan(3000)
  }),
)

it.live("opening the host and reading its sessions as the alarm does contact neither Ren nor the sandbox", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const session = yield* begin(opened)
    const script = stub.script({ hold: true })
    yield* session.send(script)
    yield* Effect.promise(() => script.called())
    expect(yield* idle(opened, session.sessionId)).toBe(false)
    expect(yield* opened.opens).toBe(0)
    expect((yield* Effect.promise(() => stat(folder(session.sessionId)).catch(() => undefined))) === undefined).toBe(
      true,
    )
    script.release()
  }),
)

it.live("destroying the ren workspace leaves the sandbox's folder and Ren untouched", () =>
  Effect.gen(function* () {
    const opened = yield* open()
    const session = yield* begin(opened)
    yield* session.turn(stub.script(shell("echo kept > kept.txt")))
    yield* opened.host.workspaces.destroy(RenWorkspaceDriver.workspaceId(session.sessionId))
    expect(yield* text(join(folder(session.sessionId), "kept.txt"))).toBe("kept\n")
    expect(yield* opened.opens).toBe(1)
  }),
)

it.live(
  "a start with a first message that names another folder creates no session, accepts no message and calls no model",
  () =>
    Effect.gen(function* () {
      const opened = yield* open()
      const sessionId = Session.ID.create()
      const script = stub.script()
      yield* opened.memory.set(sessionId, yield* accessTo(yield* Machine.url, sessionId))
      const error = yield* restart(opened.harness, sessionId, { environmentId, directory: "/workspace" }, undefined, {
        messageId: Session.MessageID.create(),
        prompt: { text: `${script.marker} hello` },
        sender: { userId: "user_1" },
      }).pipe(Effect.flip)
      expect(error.message).toBe(`Session ${sessionId} works in /workspace/${sessionId} on its sandbox, not /workspace`)
      expect((yield* opened.harness.sessions).filter((state) => String(state.id) === sessionId)).toEqual([])
      expect((yield* sendTo(opened.harness, sessionId, stub.script()).pipe(Effect.flip))._tag).toBe(
        "SessionNotStartedError",
      )
      expect([script.calls, yield* opened.opens]).toEqual([[], 0])
    }),
)
