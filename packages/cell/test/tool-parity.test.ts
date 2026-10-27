import { afterAll, expect, test } from "bun:test"
import { Credential } from "@opencode/core/credential"
import { EnvironmentFiles } from "@opencode/core/environment/files"
import { EnvironmentLocal } from "@opencode/core/environment/local"
import { RipgrepBinary } from "@opencode/core/ripgrep/binary"
// ast-grep-ignore: no-import-alias -- Ren's Session is imported too, and both are values
import { Session as OpenCodeSession } from "@opencode/core/session"
import { SessionTransfer } from "@opencode/core/session/transfer"
import { Workspace } from "@opencode/core/workspace"
import { EnvironmentApi } from "@ren/environment-api/environment-api"
import { TestEnvironment, Processes, testEffect } from "@ren/executor/testing"
import { Session } from "@ren/schema/session"
import { Context, Effect, Exit, Fiber, Layer, ManagedRuntime, Option, Scope } from "effect"
import { HttpEffect, HttpRouter } from "effect/http"
import { createServer, connect, type Socket } from "node:net"
import { lstat, mkdir, mkdtemp, readdir, realpath, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { OpenCodeHarness } from "../src/harness/opencode/harness.js"
import { OpenCodeServer } from "../src/harness/opencode/server.js"
import { RenWorkspaceDriver } from "../src/harness/opencode/workspace-driver.js"
import { Pid } from "./lib/pid.js"
import { Shared } from "./lib/shared.js"
import { RemoteHost } from "./lib/remote-host.js"
import type { StubModel } from "./lib/stub-model.js"

const stub = Shared.stub()

// oxlint-disable-next-line ren/no-comments -- A host that keeps OpenCode's own file and shell tools: Ren's plugin removes them when there is no environment. Each session works in its own folder under the root.
const localHarness = Effect.gen(function* () {
  const root = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-ref-"))))
  const runtime = yield* Effect.acquireRelease(
    Effect.sync(() =>
      ManagedRuntime.make(
        RemoteHost.embedded([
          RipgrepBinary.node.replace(
            Layer.succeed(RipgrepBinary.Service, RipgrepBinary.Service.of({ filepath: Effect.succeed("rg") })),
          ),
        ]),
      ),
    ),
    (opened) => opened.disposeEffect,
  )
  const services = yield* runtime.contextEffect
  const fetch = HttpEffect.toWebHandler(Context.get(services, HttpRouter.HttpRouter).asHttpEffect())
  yield* Effect.promise(() => fetch(new Request("http://opencode/api/agent")))
  return {
    root,
    harness: yield* OpenCodeHarness.make(
      {
        fetch,
        client: yield* OpenCodeServer.client(fetch),
        shells: () => Effect.die(new Error("The tool parity host has no shells")),
        agents: () => Effect.die(new Error("The tool parity host has no agents")),
        skills: () => Effect.die(new Error("The tool parity host has no skills")),
        commands: () => Effect.die(new Error("The tool parity host has no commands")),
        findFiles: () => Effect.die(new Error("The tool parity host has no file search")),
        webSearchProviders: () => Effect.die(new Error("The tool parity host has no web search")),
        credentials: Context.get(services, Credential.Service),
        sessions: Context.get(services, OpenCodeSession.Service),
        transfer: Context.get(services, SessionTransfer.Service),
        workspaces: Context.get(services, Workspace.Service),
        hasEnvironmentConnections: false,
        directoryOf: (sessionId) => join(root, sessionId),
        makeDirectory: (path) => Effect.promise(() => mkdir(path, { recursive: true })),
        activate: () => Effect.void,
        chats: Option.none(),
        configure: () => Effect.void,
        configuration: Effect.succeed([]),
      },
      RemoteHost.endpoints,
    ),
  }
})

class Remote extends Context.Service<Remote, RemoteHost.Opened>()("@ren/cell/test/ToolParity/Remote") {}

class Reference extends Context.Service<Reference, Effect.Success<typeof localHarness>>()(
  "@ren/cell/test/ToolParity/Reference",
) {}

// oxlint-disable-next-line ren/no-comments -- One sandbox, one remote host and one reference host serve every test of the file; each test starts its own sessions.
const shared = ManagedRuntime.make(
  Layer.mergeAll(Layer.effect(Remote, RemoteHost.open()), Layer.effect(Reference, localHarness)).pipe(
    Layer.provideMerge(RemoteHost.served),
  ),
)

afterAll(() => shared.dispose())

const services = Layer.effectContext(shared.contextEffect)

const it = testEffect(services)

const live = <A, E>(body: Effect.Effect<A, E, Layer.Success<typeof services> | Scope.Scope>) =>
  body.pipe(Effect.scoped, Effect.provide(services), Effect.runPromise)

// oxlint-disable-next-line ren/no-comments -- A proxy to the executor that counts the bytes that come back from it. The shared host outlives it and keeps its connections open, so the release ends them.
const counting = (port: number) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const state = { bytes: 0 }
      const sockets = new Set<Socket>()
      const server = createServer((client) => {
        sockets.add(client)
        const upstream = connect(port, "127.0.0.1")
        upstream.on("data", (chunk) => void (state.bytes += chunk.length))
        client
          .on("error", () => upstream.destroy())
          .on("close", () => upstream.destroy())
          .pipe(upstream)
        upstream.on("error", () => client.destroy()).pipe(client)
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const address = server.address()
      return {
        server,
        sockets,
        state,
        url: `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`,
      }
    }),
    (relay) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            for (const socket of relay.sockets) socket.destroy()
            relay.server.close(() => resolve())
          }),
      ),
  )

interface Tool {
  readonly name: string
  readonly input: Record<string, unknown>
}

type Step = { readonly tool: (dir: string) => Tool } | { readonly act: (dir: string) => Promise<unknown> }

const call = (name: string, input: Record<string, unknown>) => (): Tool => ({ name, input })

const tools = (...steps: ReadonlyArray<(dir: string) => Tool>): ReadonlyArray<Step> => steps.map((tool) => ({ tool }))

const sh = (command: string, more: Record<string, unknown> = {}) => call("shell", { command, ...more })

const act = (run: (dir: string) => Promise<unknown>): Step => ({ act: run })

const reference = Effect.fnUntraced(function* (modelId?: string) {
  const local = yield* Reference
  const sessionId = Session.ID.create()
  yield* RemoteHost.restart(local.harness, sessionId, undefined, modelId)
  return {
    directory: join(local.root, sessionId),
    send: (script: StubModel.Script) => RemoteHost.sendTo(local.harness, sessionId, script),
    turn: (script: StubModel.Script) =>
      RemoteHost.sendTo(local.harness, sessionId, script).pipe(Effect.andThen(RemoteHost.answered(script))),
  }
})

const both = Effect.fnUntraced(function* (
  before: Readonly<Record<string, string>>,
  steps: ReadonlyArray<Step>,
  modelId?: string,
) {
  const remote = yield* RemoteHost.begin(yield* Remote, undefined, modelId)
  const reference_ = yield* reference(modelId)
  const realRemote = RemoteHost.folder(remote.sessionId)
  yield* Effect.promise(() =>
    Promise.all(
      Object.entries(before).flatMap((entry) => [
        Bun.write(join(realRemote, entry[0]), entry[1]),
        Bun.write(join(reference_.directory, entry[0]), entry[1]),
      ]),
    ),
  )
  const results = {
    remote: [] as Array<string>,
    local: [] as Array<string>,
    answers: { remote: [] as Array<StubModel.Call>, local: [] as Array<StubModel.Call> },
  }
  const normalize = (text: string, real: string) => text.replaceAll(real, "<dir>")
  for (const step of steps) {
    if ("act" in step) {
      yield* Effect.promise(() => step.act(realRemote))
      yield* Effect.promise(() => step.act(reference_.directory))
      continue
    }
    const remoteCall = yield* remote.turn(stub.script({ tool: step.tool(realRemote) }))
    const localCall = yield* reference_.turn(stub.script({ tool: step.tool(reference_.directory) }))
    results.answers.remote.push(remoteCall)
    results.answers.local.push(localCall)
    results.remote.push(normalize(RemoteHost.lastToolResult(remoteCall), realRemote))
    results.local.push(normalize(RemoteHost.lastToolResult(localCall), reference_.directory))
  }
  return { ...results, realRemote, realLocal: reference_.directory }
})

interface Parity {
  readonly files?: Readonly<Record<string, string>>
  readonly steps: ReadonlyArray<Step>
  readonly modelId?: string
  readonly shows: ReadonlyArray<string>
  readonly hides?: ReadonlyArray<string>
  readonly view?: (result: string) => string
  readonly contents?: Readonly<Record<string, string | undefined>>
}

const text = (path: string) =>
  Bun.file(path)
    .exists()
    .then((exists) => (exists ? Bun.file(path).text() : undefined))

const foundFiles = (result: string) =>
  result
    .replaceAll('"', "")
    .split("\\n")
    .filter((line) => line.startsWith("<dir>") || line.startsWith("Found"))
    .toSorted()
    .join("\n")

const sameShape = (result: string) => result.replaceAll(/f\d+\.dat/g, "fN.dat")

const gitInit = act((dir) => Bun.spawn(["git", "init", "-q", dir]).exited)

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
)

const withBytes = (path: string, content: Uint8Array) => act((dir) => Bun.write(join(dir, path), content))

const lines = `${Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n")}\n`

const patchOf = (file: string, from: string, to: string) =>
  `*** Begin Patch\n*** Update File: ${file}\n@@\n-${from}\n+${to}\n*** End Patch`

test.each<[string, Parity]>([
  [
    "J19 heredoc, pipes, && and ||, subshells, quotes, command substitution, globs and unicode print what the local shell prints",
    {
      files: { "a.txt": "", "b.txt": "" },
      steps: tools(
        sh(
          [
            "cat <<EOF | tr a-z A-Z",
            "hello $(echo wörld) 'q' \"d\"",
            "EOF",
            "echo a && echo b || echo c",
            "false || echo d",
            "(cd /; pwd)",
            "echo nested $(echo deep)",
            "echo *.txt",
            "echo ünï 日本",
            "echo 'single $HOME' \"double $((1+2))\"",
          ].join("\n"),
        ),
      ),
      shows: ["HELLO WöRLD", "a.txt b.txt", "nested deep", "ünï 日本", "double 3"],
    },
  ],
  [
    "J20 a command that exits with code 3 gives its output and the exit code",
    {
      steps: tools(sh("echo out; echo err >&2; exit 3")),
      shows: ["out", "err", "Exited with code 3"],
    },
  ],
  [
    "J21 no output, only stderr and ANSI colors read the same as on the local shell",
    {
      steps: tools(sh("true"), sh("echo err >&2"), sh("printf '\\033[31mred\\033[0m\\n'")),
      shows: ["(no output)", "err", "\\u001b[31mred"],
    },
  ],
  [
    "J22 a cd in one call does not change the folder of the next call, as on the local shell",
    { steps: tools(sh("cd /tmp"), sh("pwd")), shows: ["(no output)", '"<dir>\\n"'] },
  ],
  [
    "J25 read and cat with nothing on stdin end at once",
    {
      steps: tools(sh("read x; echo got:$x"), sh("cat; echo done")),
      shows: ["got:", "done"],
    },
  ],
  [
    "J31 the shell workdir, relative, absolute, outside the session folder or missing, works as on the local shell",
    {
      files: { "sub/x": "1" },
      steps: tools(
        (dir) => ({ name: "shell", input: { command: "pwd", workdir: `${dir}/sub` } }),
        sh("pwd", { workdir: "sub" }),
        sh("pwd", { workdir: "/tmp" }),
        (dir) => ({ name: "shell", input: { command: "pwd", workdir: `${dir}/nope` } }),
      ),
      shows: ["<dir>/sub", "tmp", "Working directory does not exist: <dir>/nope"],
    },
  ],
  [
    "J32 a negative or decimal shell timeout is refused and a very large one works, as on the local shell",
    {
      steps: tools(
        sh("echo x", { timeout: -1 }),
        sh("echo x", { timeout: 1.5 }),
        sh("echo big", { timeout: 99_999_999_999 }),
      ),
      shows: ["greater than or equal to 0", "Expected an integer", "big"],
    },
  ],
  ["J33 an empty command is the same as on the local shell", { steps: tools(sh("")), shows: ["(no output)"] }],
  [
    "J35 a read with offset 0, an offset after the end or a limit of 0 gives what the local files give",
    {
      files: { "a.txt": lines },
      steps: tools(
        call("read", { path: "a.txt", offset: 0 }),
        call("read", { path: "a.txt", offset: 1, limit: 0 }),
        call("read", { path: "a.txt", offset: 50 }),
        call("read", { path: "a.txt", offset: 3, limit: 2 }),
      ),
      shows: ["lines 1-10", "out of range", "Continue reading with offset: 5"],
    },
  ],
  [
    "J36 reading a folder lists its items, and a missing path fails, as on the local files",
    {
      files: { "sub/x.txt": "1", "sub/y/z.txt": "2" },
      steps: tools(call("read", { path: "sub" }), call("read", { path: "missing.txt" })),
      shows: ["Read directory sub", "y/", "File not found: missing.txt"],
    },
  ],
  [
    "J37 an edit with an oldString that is missing or found twice fails, and replaceAll replaces both, as on the local files",
    {
      files: { "a.txt": "dup\nmid\ndup\n" },
      steps: tools(
        call("edit", { path: "a.txt", oldString: "nothing", newString: "x" }),
        call("edit", { path: "a.txt", oldString: "dup", newString: "x" }),
        call("edit", { path: "a.txt", oldString: "dup", newString: "x", replaceAll: true }),
      ),
      shows: ["Could not find oldString", "Found 2 matches", "(2 replacements)"],
      contents: { "a.txt": "x\nmid\nx\n" },
    },
  ],
  [
    "J38 a write with empty content makes an empty file",
    {
      steps: tools(call("write", { path: "e.txt", content: "" })),
      shows: ["Created file successfully: e.txt"],
      contents: { "e.txt": "" },
    },
  ],
  [
    "J39 a patch with a hunk that does not apply fails as on the local files, and the file does not change",
    {
      files: { "a.txt": "alpha\nbeta\n" },
      modelId: RemoteHost.gptModel.id,
      steps: tools(call("patch", { patchText: patchOf("a.txt", "nothere", "x") })),
      shows: ["patch verification failed", "nothere"],
      contents: { "a.txt": "alpha\nbeta\n" },
    },
  ],
  [
    "J40 a grep with a regular expression that is not valid, and a glob with no matches, give what the local files give",
    {
      files: { "a.txt": "x\n" },
      steps: tools(call("grep", { pattern: "(" }), call("glob", { pattern: "**/*.nomatch" })),
      shows: ["Invalid regex pattern", "No files found"],
    },
  ],
  [
    "J42 an image gives an attachment and a PDF gives the model's answer for PDF, as on the local files",
    {
      steps: [
        withBytes("i.png", png),
        withBytes("p.pdf", Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n")),
        ...tools(call("read", { path: "i.png" }), call("read", { path: "p.pdf" })),
      ],
      shows: ["Image read successfully", "PDF read successfully"],
    },
  ],
  [
    "J43 a binary file that is not an image fails with the local files' message",
    {
      steps: [
        withBytes("b.bin", Uint8Array.from([0, 1, 2, 3, 255, 0, 7])),
        withBytes("b.zip", Uint8Array.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0, 255])),
        ...tools(call("read", { path: "b.bin" }), call("read", { path: "b.zip" })),
      ],
      shows: ["Cannot read binary file: b.bin", "Cannot read binary file: b.zip"],
    },
  ],
  [
    "J44 an edit of a file that another writer changed after the read goes through, as on the local files",
    {
      files: { "a.txt": "one\n" },
      steps: [
        ...tools(call("read", { path: "a.txt" })),
        act((dir) => Bun.write(join(dir, "a.txt"), "two\n")),
        ...tools(call("edit", { path: "a.txt", oldString: "two", newString: "three" })),
      ],
      shows: ["Edited a.txt (1 replacement)"],
      contents: { "a.txt": "three\n" },
    },
  ],
  [
    "J45 a write in a new deep folder makes the folders",
    {
      steps: tools(call("write", { path: "deep/er/est/f.txt", content: "x" })),
      shows: ["Created file successfully: deep/er/est/f.txt"],
      contents: { "deep/er/est/f.txt": "x" },
    },
  ],
  [
    "J48 grep respects .gitignore and finds hidden files, glob lists them as the local files do",
    {
      files: {
        "a.txt": "needle\n",
        ".hidden": "needle\n",
        ".gitignore": "ignored.txt\n",
        "ignored.txt": "needle\n",
        "sub/b.txt": "needle\n",
      },
      steps: [gitInit, ...tools(call("grep", { pattern: "needle" }), call("glob", { pattern: "**/*" }))],
      view: foundFiles,
      shows: ["Found 3 matches", "<dir>/.hidden", "<dir>/sub/b.txt"],
      hides: ["<dir>/ignored.txt:"],
    },
  ],
  [
    "J48 glob and grep with 101 results cut at 100 with the local files' notice",
    {
      steps: [
        act((dir) =>
          Promise.all(
            Array.from({ length: 101 }, (_, index) => Bun.write(join(dir, `many/f${index}.dat`), "needle\n")),
          ),
        ),
        ...tools(call("glob", { pattern: "**/*.dat" }), call("grep", { pattern: "needle", include: "*.dat" })),
      ],
      view: sameShape,
      shows: ["Found 100 matches", "(Results are truncated: showing first 100 results."],
    },
  ],
  [
    "J49 an edit keeps CRLF, a missing last new line and a unicode file name",
    {
      steps: [
        withBytes("c.txt", Buffer.from("a\r\nb\r\nc")),
        withBytes("ünï-日本.txt", Buffer.from("x")),
        ...tools(
          call("edit", { path: "c.txt", oldString: "b", newString: "B" }),
          call("edit", { path: "ünï-日本.txt", oldString: "x", newString: "y" }),
        ),
      ],
      shows: ["Edited c.txt", "Edited ünï-日本.txt"],
      contents: { "c.txt": "a\r\nB\r\nc", "ünï-日本.txt": "y" },
    },
  ],
])("%s", (_name, parity) =>
  live(
    Effect.gen(function* () {
      const result = yield* both(parity.files ?? {}, parity.steps, parity.modelId)
      const view = parity.view ?? ((value: string) => value)
      expect(result.remote.map(view)).toEqual(result.local.map(view))
      const shown = result.remote.map(view).join("\n")
      expect(parity.shows.filter((part) => !shown.includes(part))).toEqual([])
      expect(parity.hides?.filter((part) => shown.includes(part)) ?? []).toEqual([])
      yield* Effect.forEach(
        Object.entries(parity.contents ?? {}),
        (entry) =>
          Effect.promise(async () => ({
            remote: await text(join(result.realRemote, entry[0])),
            local: await text(join(result.realLocal, entry[0])),
          })).pipe(
            Effect.tap((found) => Effect.sync(() => expect(found).toEqual({ remote: entry[1], local: entry[1] }))),
          ),
        { discard: true },
      )
      const attached = (calls: ReadonlyArray<StubModel.Call>) =>
        calls.some((answer) => JSON.stringify(answer.body.messages).includes("image_url"))
      if (parity.steps.some((step) => "act" in step && parity.shows.includes("Image read successfully")))
        expect([attached(result.answers.remote), attached(result.answers.local)]).toEqual([true, true])
    }),
  ),
)

// oxlint-disable-next-line ren/no-comments -- OpenCode's own files on the host disk: the same driver that a session without an environment uses.
const localFiles = (spawner: Parameters<typeof EnvironmentLocal.makeLocalDriver>[0]): EnvironmentFiles.FilesImpl => {
  const overrides = EnvironmentLocal.makeLocalDriver(spawner).overrides
  const missing = Effect.die(new Error("OpenCode's local driver has no such file operation"))
  return {
    read: (path, range) => overrides?.read?.(path, range) ?? missing,
    write: (path, bytes) => overrides?.write?.(path, bytes) ?? missing,
    stat: (path) => overrides?.stat?.(path) ?? missing,
    list: (path) => overrides?.list?.(path) ?? missing,
    remove: (path) => overrides?.remove?.(path) ?? missing,
    move: (from, to) => overrides?.move?.(from, to) ?? missing,
    mkdir: (path) => overrides?.mkdir?.(path) ?? missing,
  }
}

it.live("J23 a shell timeout says so, and the command and its child stop on the sandbox", () =>
  Effect.gen(function* () {
    const session = yield* RemoteHost.begin(yield* Remote)
    const dir = yield* RemoteHost.scratch()
    const answer = yield* session.turn(
      stub.script(
        RemoteHost.shellWith(`echo $$ > ${dir}/main; sleep 60 & echo $! > ${dir}/child; wait`, { timeout: 100 }),
      ),
    )
    expect(RemoteHost.lastToolResult(answer)).toContain("Command exceeded timeout of 100 ms")
    const pids = yield* Effect.forEach(["main", "child"], (name) => Pid.read(join(dir, name)))
    expect(yield* Effect.forEach(pids, (pid) => RemoteHost.stops(pid, 30))).toEqual([true, true])
  }),
)

const closedHarnessStops = (seconds: number) =>
  live(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const opened = yield* RemoteHost.open().pipe(Effect.provideService(Scope.Scope, scope))
      const session = yield* RemoteHost.begin(opened)
      const dir = yield* RemoteHost.scratch()
      const answer = yield* session.turn(
        stub.script(RemoteHost.shellWith(`echo $$ > ${dir}/main; exec sleep 300`, { background: true })),
      )
      expect(RemoteHost.lastToolResult(answer)).toContain("Command moved to the background")
      const pid = yield* Pid.read(join(dir, "main"))
      yield* Effect.promise(async () => {
        // ast-grep-ignore: no-test-sleep -- the session must be idle before the cell closes, and idle is only visible by polling
        while ((await Effect.runPromise(opened.harness.sessions)).some((state) => state.active)) await Bun.sleep(100)
      })
      expect(Processes.running(pid)).toBe(true)
      yield* Scope.close(scope, Exit.void)
      const stopped = yield* RemoteHost.stops(pid, seconds)
      if (!stopped) process.kill(pid, "SIGKILL")
      expect(stopped).toBe(true)
    }),
  )

test(
  "J28 a background job stops on the sandbox within the executor's orphan time and one scan after the idle cell closes",
  () => closedHarnessStops(33),
  90_000,
)

test.todo("J28 a background job stops on the sandbox 30 seconds or less after the idle cell closes", () =>
  closedHarnessStops(30))

test("J29 five shell calls at once each get only their own output", () =>
  live(
    Effect.gen(function* () {
      const opened = yield* Remote
      const dir = yield* RemoteHost.scratch()
      const marks = Array.from({ length: 5 }, () => crypto.randomUUID())
      const sessions = yield* Effect.forEach(marks, () => RemoteHost.begin(opened))
      const running = yield* Effect.forEach(
        sessions.map((session, index) => ({ session, mark: marks[index] ?? "" })),
        (entry) =>
          entry.session.turn(
            stub.script(
              RemoteHost.shell(
                `echo $$ > ${dir}/${entry.mark}; while [ ! -e ${dir}/go ]; do sleep 0.01; done; echo out-${entry.mark}`,
              ),
            ),
          ),
        { concurrency: "unbounded" },
      ).pipe(Effect.forkChild)
      yield* Effect.forEach(marks, (mark) => Pid.read(join(dir, mark)))
      yield* Effect.promise(() => Bun.write(join(dir, "go"), ""))
      const results = (yield* Fiber.join(running)).map(RemoteHost.lastToolResult)
      expect(results).toEqual(marks.map((mark) => JSON.stringify(`out-${mark}\n`)))
    }),
  ))

it.live("J34 a command with a NUL byte fails with a clear error, and the cell goes on", () =>
  Effect.gen(function* () {
    const opened = yield* Remote
    const session = yield* RemoteHost.begin(opened)
    const marker = join(RemoteHost.workspace, `${crypto.randomUUID()}.ran`)
    const refused = RemoteHost.lastToolResult(
      yield* session.turn(stub.script(RemoteHost.shell(`touch ${marker}\u0000; echo a`))),
    )
    expect(refused).toContain("must be a string without null bytes")
    expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
    expect(RemoteHost.lastToolResult(yield* session.turn(stub.script(RemoteHost.shell("echo alive"))))).toBe(
      JSON.stringify("alive\n"),
    )
  }),
)

const longLines = 32_768

const pagesOf2MiB = Effect.fnUntraced(function* (offsets: ReadonlyArray<number>) {
  const proxy = yield* counting(Number(new URL(yield* TestEnvironment.url).port))
  const session = yield* RemoteHost.begin(yield* Remote, proxy.url)
  yield* Effect.promise(() =>
    Bun.write(
      join(RemoteHost.folder(session.sessionId), "big.txt"),
      Array.from(
        { length: longLines },
        (_, index) => `line ${String(index + 1).padStart(6, "0")} ${"x".repeat(51)}\n`,
      ).join(""),
    ),
  )
  yield* session.turn(stub.script(RemoteHost.shell("true")))
  return yield* Effect.forEach(offsets, (offset) =>
    Effect.gen(function* () {
      const before = proxy.state.bytes
      const answer = yield* session.turn(
        stub.script({ tool: { name: "read", input: { path: "big.txt", offset, limit: 2 } } }),
      )
      return { offset, result: RemoteHost.lastToolResult(answer), transferred: proxy.state.bytes - before }
    }),
  )
})

const mebibyte = 1024 * 1024

it.live("J41 reads a 2 MiB file page by page with the right lines, and the first page does not transfer the file", () =>
  Effect.gen(function* () {
    const pages = yield* pagesOf2MiB([1, 16_001, longLines - 1])
    expect(pages.map((page) => page.result)).toEqual(
      pages.map(
        (page) =>
          `"Read file big.txt, lines ${page.offset}-${page.offset + 1}\\n${[page.offset, page.offset + 1]
            .map((line) => `${line}: line ${String(line).padStart(6, "0")} ${"x".repeat(51)}`)
            .join(
              "\\n",
            )}${page.offset + 1 < longLines ? `\\n[Output truncated. Continue reading with offset: ${page.offset + 2}]` : ""}"`,
      ),
    )
    expect(pages[0]?.transferred).toBeLessThan(mebibyte)
  }),
)

test.todo("J41 a page near the end of a 2 MiB file does not transfer the file", () =>
  live(
    Effect.gen(function* () {
      const pages = yield* pagesOf2MiB([longLines - 1])
      expect(pages[0]?.transferred).toBeLessThan(mebibyte)
    }),
  ))

const outsideWrite = Effect.fnUntraced(function* () {
  const session = yield* RemoteHost.begin(yield* Remote)
  const path = join(RemoteHost.workspace, `outside-${crypto.randomUUID()}.txt`)
  const result = RemoteHost.lastToolResult(
    yield* session.turn(stub.script({ tool: { name: "write", input: { path, content: "outside\n" } } })),
  )
  return { result, written: yield* Effect.promise(() => text(path)) }
})

it.live(
  "J46 a write outside the session's folder is not asked about, also when not interactive, and lands on the sandbox",
  () =>
    Effect.gen(function* () {
      const outcome = yield* outsideWrite()
      expect(outcome.result).toContain("Created file successfully")
      expect(outcome.written).toBe("outside\n")
    }),
)

test.todo("J46 a write outside /workspace is refused by external_directory when the start is not interactive", () =>
  live(
    Effect.gen(function* () {
      const outcome = yield* outsideWrite()
      expect(outcome.result).not.toContain("Created file successfully")
      expect(outcome.written).toBeUndefined()
    }),
  ))

it.live(
  "J50 a read of a file over the sandbox's whole-file limit with no range gives a short answer, and the cell goes on",
  () =>
    Effect.gen(function* () {
      const session = yield* RemoteHost.begin(yield* Remote)
      yield* Effect.promise(() =>
        Bun.write(
          join(RemoteHost.folder(session.sessionId), "huge.bin"),
          Buffer.alloc(EnvironmentApi.maxFileBytes + 1, 97),
        ),
      )
      const answer = RemoteHost.lastToolResult(
        yield* session.turn(stub.script({ tool: { name: "read", input: { path: "huge.bin" } } })),
      )
      expect(answer).toContain("Read file huge.bin")
      expect(answer.length).toBeLessThan(100_000)
      expect(RemoteHost.lastToolResult(yield* session.turn(stub.script(RemoteHost.shell("echo alive"))))).toBe(
        JSON.stringify("alive\n"),
      )
    }),
)

it.live("J51 a session reads a file that another session wrote on the same sandbox, by the sandbox's path", () =>
  Effect.gen(function* () {
    const opened = yield* Remote
    const first = yield* RemoteHost.begin(opened)
    const second = yield* RemoteHost.begin(opened)
    yield* first.turn(stub.script(RemoteHost.shell("echo shared > f.txt")))
    const answer = yield* second.turn(
      stub.script({ tool: { name: "read", input: { path: join(RemoteHost.folder(first.sessionId), "f.txt") } } }),
    )
    expect(RemoteHost.lastToolResult(answer)).toContain("1: shared")
  }),
)

it.live(
  "B20 a chat on the brain's own hand is denied another chat's folder and the brain's state, and allowed /tmp",
  () =>
    Effect.gen(function* () {
      const opened = yield* RemoteHost.open({ workspace: RemoteHost.workspace, allow: ["/tmp/"] })
      const first = yield* RemoteHost.begin(opened)
      const second = yield* RemoteHost.begin(opened)
      yield* first.turn(stub.script(RemoteHost.shell("echo first-chat-only > f.txt")))
      const read = (path: string) =>
        second
          .turn(stub.script({ tool: { name: "read", input: { path } } }))
          .pipe(Effect.map(RemoteHost.lastToolResult))
      const scratch = `/tmp/ren-b20-${crypto.randomUUID()}.txt`
      const written = RemoteHost.lastToolResult(
        yield* second.turn(stub.script({ tool: { name: "write", input: { path: scratch, content: "scratch\n" } } })),
      )
      const other = yield* read(join(RemoteHost.folder(first.sessionId), "f.txt"))
      expect(other).toContain("its own folder")
      expect(other).not.toContain("first-chat-only")
      expect(yield* read(join(dirname(RemoteHost.workspace), ".ren", "brain.env"))).toContain("its own folder")
      expect(written).toContain("Created file successfully")
      expect(yield* Effect.promise(() => text(scratch))).toBe("scratch\n")
    }),
)

test.todo("J51 a session reads another session's file by that session's /workspace/<session> path", () =>
  live(
    Effect.gen(function* () {
      const opened = yield* Remote
      const first = yield* RemoteHost.begin(opened)
      const second = yield* RemoteHost.begin(opened)
      yield* first.turn(stub.script(RemoteHost.shell("echo shared > f.txt")))
      const answer = yield* second.turn(
        stub.script({ tool: { name: "read", input: { path: `${RemoteHost.folder(first.sessionId)}/f.txt` } } }),
      )
      expect(RemoteHost.lastToolResult(answer)).toContain("1: shared")
    }),
  ))

it.live("J52 interrupting one session's turn leaves another session's command running", () =>
  Effect.gen(function* () {
    const opened = yield* Remote
    const first = yield* RemoteHost.begin(opened)
    const second = yield* RemoteHost.begin(opened)
    const dir = yield* RemoteHost.scratch()
    const running = stub.script(
      RemoteHost.shell(`echo $$ > ${dir}/first; while [ ! -e ${dir}/go ]; do sleep 0.01; done; echo first-done`),
    )
    yield* first.send(running)
    const firstPid = yield* Pid.read(join(dir, "first"))
    yield* second.send(stub.script(RemoteHost.shell(`echo $$ > ${dir}/second; exec sleep 60`)))
    const secondPid = yield* Pid.read(join(dir, "second"))
    const own = (yield* opened.harness.sessions).find((state) => String(state.id) === second.sessionId)
    expect(own).toBeDefined()
    if (!own) return
    yield* own.interrupt
    expect(yield* Processes.exits(secondPid)).toBe(true)
    expect(Processes.running(firstPid)).toBe(true)
    yield* Effect.promise(() => Bun.write(join(dir, "go"), ""))
    expect(RemoteHost.lastToolResult(yield* Effect.promise(() => running.called(2)))).toBe(
      JSON.stringify("first-done\n"),
    )
  }),
)

type FileFailure = { readonly _tag: string; readonly path?: string; readonly actual?: string }

const bytesOf = (value: {
  readonly bytes: Uint8Array
  readonly info: { readonly type: string; readonly size: number }
}) => ({
  text: new TextDecoder().decode(value.bytes),
  type: value.info.type,
  size: value.info.size,
})

const encode = (value: string) => new TextEncoder().encode(value)

const fileOperations: ReadonlyArray<
  readonly [
    string,
    (files: EnvironmentFiles.FilesImpl, at: (name: string) => string) => Effect.Effect<unknown, FileFailure>,
  ]
> = [
  ["read a file", (files, at) => files.read(at("f.txt")).pipe(Effect.map(bytesOf))],
  ["read an empty file", (files, at) => files.read(at("empty.txt")).pipe(Effect.map(bytesOf))],
  ["read a range", (files, at) => files.read(at("f.txt"), { offset: 6, length: 5 }).pipe(Effect.map(bytesOf))],
  [
    "read a range after the end",
    (files, at) => files.read(at("f.txt"), { offset: 100, length: 5 }).pipe(Effect.map(bytesOf)),
  ],
  ["read a folder", (files, at) => files.read(at("dir"))],
  ["read a missing path", (files, at) => files.read(at("missing"))],
  ["read a path under a file", (files, at) => files.read(at("f.txt/child"))],
  ["read a link to a file", (files, at) => files.read(at("link-file")).pipe(Effect.map(bytesOf))],
  ["read a link to a folder", (files, at) => files.read(at("link-dir"))],
  ["read a dangling link", (files, at) => files.read(at("dangling"))],
  ["stat a file", (files, at) => files.stat(at("f.txt")).pipe(Effect.map((info) => [info.type, info.size]))],
  ["stat a folder", (files, at) => files.stat(at("dir")).pipe(Effect.map((info) => info.type))],
  ["stat a link to a file", (files, at) => files.stat(at("link-file")).pipe(Effect.map((info) => info.type))],
  ["stat a link to a folder", (files, at) => files.stat(at("link-dir")).pipe(Effect.map((info) => info.type))],
  ["stat a dangling link", (files, at) => files.stat(at("dangling")).pipe(Effect.map((info) => info.type))],
  ["stat a missing path", (files, at) => files.stat(at("missing"))],
  [
    "list a folder",
    (files, at) =>
      files.list(at("dir")).pipe(Effect.map((entries) => entries.toSorted((a, b) => a.name.localeCompare(b.name)))),
  ],
  [
    "list a link to a folder",
    (files, at) => files.list(at("link-dir")).pipe(Effect.map((entries) => entries.map((entry) => entry.name))),
  ],
  [
    "list the tree root",
    (files, at) =>
      files.list(at("")).pipe(Effect.map((entries) => entries.toSorted((a, b) => a.name.localeCompare(b.name)))),
  ],
  ["list a file", (files, at) => files.list(at("f.txt"))],
  ["list a missing path", (files, at) => files.list(at("missing"))],
  ["list a dangling link", (files, at) => files.list(at("dangling"))],
  ["write a new file in new folders", (files, at) => files.write(at("new/deep/w.txt"), encode("written"))],
  ["write an empty file", (files, at) => files.write(at("new/empty.txt"), new Uint8Array())],
  ["write over a file", (files, at) => files.write(at("f.txt"), encode("over"))],
  ["write through a link to a file", (files, at) => files.write(at("link-file"), encode("through"))],
  ["write under a file", (files, at) => files.write(at("f.txt/child"), encode("x"))],
  ["write over a folder", (files, at) => files.write(at("dir"), encode("x"))],
  ["read back after the writes", (files, at) => files.read(at("f.txt")).pipe(Effect.map(bytesOf))],
  ["make a folder in new folders", (files, at) => files.mkdir(at("made/a/b"))],
  ["make a folder that exists", (files, at) => files.mkdir(at("dir"))],
  ["make a folder over a file", (files, at) => files.mkdir(at("empty.txt"))],
  ["make a folder under a file", (files, at) => files.mkdir(at("empty.txt/x"))],
  ["move a file to a new name", (files, at) => files.move(at("empty.txt"), at("renamed.txt"))],
  ["move a file into a folder", (files, at) => files.move(at("renamed.txt"), at("dir"))],
  ["move a missing path", (files, at) => files.move(at("missing"), at("somewhere"))],
  ["move a folder", (files, at) => files.move(at("made"), at("moved-made"))],
  ["move a link", (files, at) => files.move(at("link-dir"), at("link-moved"))],
  ["remove a file", (files, at) => files.remove(at("new/empty.txt"))],
  ["remove a link", (files, at) => files.remove(at("link-file"))],
  ["remove a folder with files", (files, at) => files.remove(at("dir"))],
  ["remove a missing path", (files, at) => files.remove(at("missing"))],
  ["stat the removed folder", (files, at) => files.stat(at("dir"))],
]

const tree = async (dir: string, prefix = ""): Promise<ReadonlyArray<string>> =>
  (
    await Promise.all(
      (await readdir(join(dir, prefix)))
        .toSorted()
        // oxlint-disable-next-line oxc/no-map-spread -- each entry becomes a list of paths, not a modified object
        .map(async (name) => {
          const path = join(prefix, name)
          const info = await lstat(join(dir, path))
          if (info.isDirectory()) return [`${path}/`, ...(await tree(dir, path))]
          return [`${path}${info.isSymbolicLink() ? "@" : ""}:${info.isFile() ? info.size : 0}`]
        }),
    )
  ).flat()

it.live(
  "I8 each file operation of the ren driver gives the results and errors of OpenCode's local files, on the same tree",
  () =>
    Effect.gen(function* () {
      const opened = yield* Remote
      const sessionId = Session.ID.create()
      yield* opened.memory.set(sessionId, yield* RemoteHost.accessTo(yield* TestEnvironment.url, sessionId))
      const driver = RenWorkspaceDriver.session(opened.environments, sessionId)
      const realLocal = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-files-"))))
      const subjects = {
        remote: { files: driver.overrides, root: RemoteHost.folder(sessionId), real: RemoteHost.folder(sessionId) },
        local: { files: localFiles(driver.spawner), root: realLocal, real: realLocal },
      }
      yield* Effect.promise(() => mkdir(subjects.remote.real, { recursive: true }))
      const setup = async (dir: string) => {
        await mkdir(join(dir, "dir/nested"), { recursive: true })
        await Bun.write(join(dir, "f.txt"), "hello world")
        await Bun.write(join(dir, "empty.txt"), "")
        await Bun.write(join(dir, "dir/nested/n.txt"), "nested")
        await symlink("f.txt", join(dir, "link-file"))
        await symlink("dir", join(dir, "link-dir"))
        await symlink("gone", join(dir, "dangling"))
      }
      yield* Effect.promise(() => Promise.all([setup(subjects.remote.real), setup(subjects.local.real)]))
      const results = yield* Effect.forEach(Object.values(subjects), (subject) =>
        Effect.forEach(fileOperations, (operation) =>
          operation[1](subject.files, (name) => join(subject.root, name)).pipe(
            Effect.map((value) => ({ ok: value })),
            Effect.catch((error) =>
              Effect.succeed({
                error: error._tag,
                path: error.path?.replaceAll(subject.root, "<root>"),
                actual: error.actual,
              }),
            ),
            Effect.map((result) => [operation[0], result] as const),
          ),
        ),
      )
      const [remote, local] = results
      expect(Object.fromEntries(remote ?? [])).toEqual(Object.fromEntries(local ?? []))
      expect(yield* Effect.promise(() => tree(subjects.remote.real))).toEqual(
        yield* Effect.promise(() => tree(subjects.local.real)),
      )
    }),
)
