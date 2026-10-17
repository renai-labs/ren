import { expect, setDefaultTimeout, test } from "bun:test"
import { AbsolutePath } from "@opencode/client/effect"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { EnvironmentBindings } from "@ren/brain/environment-bindings"
import { Environments } from "@ren/brain/environments"
import { EnvironmentAccess } from "@ren/brain/environment-access"
import { OpenCodeWorkspaceDriver } from "@ren/brain/opencode-workspace-driver"
import { Machine, Processes, Relay, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Context, Effect, Exit, Layer, Option, Schema, Scope } from "effect"
import { KeyValueStore } from "effect/persistence"
import { FetchHttpClient, HttpServer } from "effect/http"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Env } from "../src/env.js"
import type { Harness } from "../src/harness/harness.js"
import { OpenCodeHarness } from "../src/harness/opencode/harness.js"
import { Host } from "../src/harness/opencode/host.js"
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

const live = <A, E>(body: Effect.Effect<A, E, Scope.Scope | Layer.Success<typeof served>>) =>
  body.pipe(Effect.scoped, Effect.provide(served), Effect.runPromise)

const machine = Effect.fnUntraced(function* (id: Environment.ID) {
  const directory = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-machine-"))))
  const scope = yield* Scope.fork(yield* Scope.Scope)
  const context = yield* Layer.buildWithMemoMap(
    Machine.layer({ environmentId: id, workspace: directory }),
    yield* Layer.makeMemoMap,
    scope,
  )
  return {
    directory,
    url: yield* Machine.url.pipe(Effect.provideContext(context)),
    stop: Scope.close(scope, Exit.void),
  }
})

const accessTo = (url: string, brain: Brain.ID, id = environmentId) => Machine.access({ url, environmentId: id, brain })

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

const openServed = Effect.fnUntraced(function* (directory = workspace) {
  return yield* open(EnvironmentAccess.layerFixed([yield* accessTo(yield* Machine.url, Brain.ID.create())]), directory)
})

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
  environments?: ReadonlyArray<Environment.Location>,
  agent?: string,
) =>
  harness.start({
    sessionId,
    harness: "opencode",
    instructions: {},
    interactive: false,
    ...(environments && { environments }),
    ...(agent && { agent }),
  })

const begin = Effect.fnUntraced(function* (
  harness: Harness.Instance,
  environments: ReadonlyArray<Environment.Location> = [{ environmentId, directory: workspace }],
  agent?: string,
) {
  const sessionId = Session.ID.create()
  yield* restart(harness, sessionId, environments, agent)
  const send = (script: StubModel.Script) => sendTo(harness, sessionId, script)
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

const noteOf = (call: StubModel.Call) =>
  call.body.messages
    .map((message) => JSON.stringify(message.content ?? ""))
    .reduce<RegExpMatchArray | null>((current, content) => {
      if (content.includes('ren.environment\\\" no longer applies')) return null
      return content.match(/Your file and shell tools run on environment (env_\w+), in ([^.]+)\./) ?? current
    }, null)

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
      yield* accessTo(yield* Machine.url, brain),
      yield* accessTo(other.url, brain, otherId),
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
    ["shell.txt", workspace],
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
])("runs the %s tool on the environment's executor, in the attached directory", (_name, tool, before, output, after) =>
  live(
    Effect.gen(function* () {
      yield* Effect.forEach(Object.entries(before), (entry) =>
        Effect.promise(() => Bun.write(join(workspace, entry[0]), entry[1])),
      )
      const session = yield* begin(yield* openServed())
      const result = toolOutput(yield* session.turn(stub.script({ tool })))
      expect(output.filter((part) => !result.includes(part))).toEqual([])
      expect(yield* Effect.forEach(Object.keys(after), (path) => text(join(workspace, path)))).toEqual(
        Object.values(after),
      )
    }),
  ),
)

it.live("runs a subagent's tools on its parent session's environment", () =>
  Effect.gen(function* () {
    const file = `${crypto.randomUUID()}.txt`
    const child = stub.script(shell(`echo $((40 + 2)) > ${file}`))
    const session = yield* begin(yield* openServed())
    yield* session.turn(
      stub.script({
        tool: {
          name: "subagent",
          input: { agent: "general", description: "Write a file", prompt: `${child.marker} write it` },
        },
      }),
    )
    expect(child.calls.length).toBeGreaterThanOrEqual(2)
    expect(yield* text(join(workspace, file))).toBe("42\n")
  }),
)

it.live("interrupting a turn kills its command on the environment", () =>
  Effect.gen(function* () {
    const harness = yield* openServed()
    const session = yield* begin(harness)
    const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
    yield* session.send(stub.script(shell(`echo $$ > ${pidFile}; exec sleep 60`)))
    const pid = yield* Pid.read(pidFile)
    const own = (yield* harness.sessions).find((state) => String(state.id) === session.sessionId)
    expect(own).toBeDefined()
    if (!own) return
    yield* own.interrupt
    expect(yield* Processes.exits(pid)).toBe(true)
  }),
)

test.each<[string, string, ReadonlyArray<ReadonlyArray<Environment.Location>>, string | undefined, boolean]>([
  ["attached", workspace, [[{ environmentId, directory: workspace }]], undefined, true],
  ["never attached", local, [[]], undefined, false],
  ["never attached, under an agent that allows the shell", local, [[]], "explore", false],
  ["detached", workspace, [[{ environmentId, directory: workspace }], []], undefined, false],
  [
    "reattached",
    workspace,
    [[{ environmentId, directory: workspace }], [], [{ environmentId, directory: workspace }]],
    undefined,
    true,
  ],
])(
  "a session %s to an environment is offered the file and shell tools only while it has one, and never questions",
  (_name, directory, steps, agent, offered) =>
    live(
      Effect.gen(function* () {
        const harness = yield* openServed(directory)
        const session = yield* begin(harness, steps[0], agent)
        yield* Effect.forEach(steps.slice(1), (step) => restart(harness, session.sessionId, step))
        const call = yield* session.turn(stub.script(), 1)
        expect(fileTools.filter((tool) => call.tools.includes(tool))).toEqual(offered ? fileTools : [])
        expect(call.tools).not.toContain("question")
      }),
    ),
)

it.live("a session attached after it started runs its shell and search tools in the environment's directory", () =>
  Effect.gen(function* () {
    const harness = yield* openServed(local)
    const session = yield* begin(harness, [])
    yield* session.turn(stub.script(), 1)
    yield* restart(harness, session.sessionId, [{ environmentId, directory: workspace }])
    const file = `${crypto.randomUUID()}.txt`
    expect(toolOutput(yield* session.turn(stub.script(shell(`echo attached > ${file} && pwd`))))).toContain(workspace)
    expect(yield* text(join(workspace, file))).toBe("attached\n")
    const name = `moved-${crypto.randomUUID().slice(0, 8)}.ts`
    yield* Effect.promise(() => Bun.write(join(workspace, "found", name), "export {}\n"))
    const globbed = yield* session.turn(stub.script({ tool: { name: "glob", input: { pattern: "**/moved-*.ts" } } }))
    expect(toolOutput(globbed)).toContain(name)
    const grepped = yield* session.turn(stub.script({ tool: { name: "grep", input: { pattern: "export" } } }))
    expect(toolOutput(grepped)).toContain(name)
  }),
)

it.live("a move waits for a running turn, then the next turn runs on the new machine and keeps the conversation", () =>
  Effect.gen(function* () {
    const setup = yield* withSecondMachine
    const session = yield* begin(setup.harness)
    const file = `${crypto.randomUUID()}.txt`
    yield* session.turn(stub.script(shell(`echo first > ${file}`)))
    const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
    const running = stub.script(shell(`echo $$ > ${pidFile}; sleep 2; echo slept`))
    yield* session.send(running)
    yield* Pid.read(pidFile)
    yield* restart(setup.harness, session.sessionId, [setup.there])
    expect(toolOutput(yield* Effect.promise(() => running.called(2)))).toContain("slept")
    const answered = yield* session.turn(stub.script(shell(`echo second > ${file} && pwd`)))
    expect(toolOutput(answered)).toContain(setup.other.directory)
    expect(JSON.stringify(answered.body.messages)).toContain("first")
    expect(yield* text(join(workspace, file))).toBe("first\n")
    expect(yield* text(join(setup.other.directory, file))).toBe("second\n")
  }),
)

it.live("keeps a session's environment when a later start does not name one", () =>
  Effect.gen(function* () {
    const harness = yield* openServed()
    const session = yield* begin(harness)
    yield* restart(harness, session.sessionId)
    const file = `${crypto.randomUUID()}.txt`
    yield* session.turn(stub.script(shell(`echo kept > ${file}`)))
    expect(yield* text(join(workspace, file))).toBe("kept\n")
  }),
)

it.live("refuses to move a session while its turn runs", () =>
  Effect.gen(function* () {
    const harness = yield* openServed()
    const session = yield* begin(harness)
    const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
    yield* session.send(stub.script(shell(`echo $$ > ${pidFile}; exec sleep 30`)))
    yield* Pid.read(pidFile)
    const error = yield* restart(harness, session.sessionId, []).pipe(Effect.flip)
    expect(error.message).toContain("is running")
    const own = (yield* harness.sessions).find((state) => String(state.id) === session.sessionId)
    if (own) yield* own.interrupt
  }),
)

it.live("a new session started on a machine with a first message runs that first turn on the machine", () =>
  Effect.gen(function* () {
    const harness = yield* openServed()
    const file = `${crypto.randomUUID()}.txt`
    const script = stub.script(shell(`echo first > ${file}`))
    yield* harness.start({
      sessionId: Session.ID.create(),
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
    expect(yield* text(join(workspace, file))).toBe("first\n")
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
        yield* accessTo(yield* Machine.url, brain),
        yield* accessTo(dead.url, brain, deadId),
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
        const error = yield* restart(harness, sessionId, [location]).pipe(Effect.flip)
        const send = yield* sendTo(harness, sessionId, stub.script()).pipe(Effect.flip)
        return [error._tag, send._tag]
      }),
    )
    expect(outcomes).toEqual(Array(3).fill(["BrainRejectedError", "SessionNotStartedError"]))
  }),
)

it.live("a background helper's command finishes where it started, and the helper's next step follows the move", () =>
  Effect.gen(function* () {
    const setup = yield* withSecondMachine
    const session = yield* begin(setup.harness)
    const childFile = `${crypto.randomUUID()}.txt`
    const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
    const child = stub.script(shell(`echo $$ > ${pidFile}; sleep 2; pwd > ${childFile}`))
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
    yield* Pid.read(pidFile)
    yield* restart(setup.harness, session.sessionId, [setup.there])
    yield* Effect.promise(() => child.called(2))
    expect(yield* text(join(workspace, childFile))).toBe(`${workspace}\n`)
    const next = stub.script(shell("pwd"))
    yield* sendTo(setup.harness, Session.ID.make(childId), next)
    expect(toolOutput(yield* Effect.promise(() => next.called(2)))).toContain(setup.other.directory)
  }),
)

it.live("a queued turn that starts while a move lands runs its command where the model is told it runs", () =>
  Effect.gen(function* () {
    const setup = yield* withSecondMachine
    const session = yield* begin(setup.harness)
    const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
    const running = stub.script(shell(`echo $$ > ${pidFile}; sleep 1`))
    const queued = stub.script(shell("pwd"))
    yield* session.send(running)
    yield* sendTo(setup.harness, session.sessionId, queued, "queue")
    yield* Pid.read(pidFile)
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

it.live("a helper of a session with no machine has no file or shell tools", () =>
  Effect.gen(function* () {
    const session = yield* begin(yield* openServed(local), [])
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
    const read = yield* session.turn(stub.script({ tool: { name: "read", input: { path } } }))
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

it.live(
  "the model is told the right machine and path mapping after each move, folder change, detach and reattach",
  () =>
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
      const calls = yield* Effect.forEach(steps, (step) =>
        restart(setup.harness, session.sessionId, step).pipe(Effect.andThen(session.turn(stub.script(), 1))),
      )
      expect(calls.map((call) => noteOf(call)?.slice(1, 3) ?? null)).toEqual([
        [setup.otherId, setup.other.directory],
        [setup.otherId, sub],
        null,
        [environmentId, workspace],
      ])
      expect(JSON.stringify(calls[0]?.body.messages)).toContain(
        `Paths under ${workspace} refer to ${setup.other.directory}`,
      )
    }),
)

it.live(
  "removing a machine's access lets a running command finish, refuses the next one, and access back restores tools",
  () =>
    Effect.gen(function* () {
      const access = yield* accessTo(yield* Machine.url, Brain.ID.create())
      const context = yield* Layer.build(EnvironmentAccess.layerMemory([access]))
      const memory = Context.get(context, EnvironmentAccess.Memory)
      const session = yield* begin(yield* open(Layer.succeedContext(context)))
      const pidFile = join(workspace, `${crypto.randomUUID()}.pid`)
      const running = stub.script(shell(`echo $$ > ${pidFile}; sleep 2; echo finished`))
      yield* session.send(running)
      yield* Pid.read(pidFile)
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
    const relay = yield* Relay.make(Relay.portOf(yield* Machine.url))
    const access = yield* accessTo(relay.url, Brain.ID.create())
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
