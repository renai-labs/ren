import { expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import { EnvironmentApi } from "@ren/environment-api/environment-api"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { ConfigProvider, Context, Deferred, Duration, Effect, Exit, Fiber, Layer, Option, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { existsSync } from "node:fs"
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { heapStats } from "bun:jsc"
import { Executor } from "../src/executor.js"
import { Sandbox } from "../src/sandbox.js"
import { testEffect } from "./lib/effect.js"
import { Processes } from "./lib/process.js"

const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-executor-")))
const executor = Sandbox.layer.pipe(
  Layer.provide(BunServices.layer),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        EXECUTOR_ENVIRONMENT_ID: Environment.ID.create(),
        EXECUTOR_WORKSPACE: workspace,
        ...(process.env.SHELL && { SHELL: process.env.SHELL }),
      }),
    ),
  ),
)
const it = testEffect(executor)
const brain = Brain.ID.create()
const decoder = new TextDecoder()
const encoder = new TextEncoder()

const run = Effect.fnUntraced(function* (input: EnvironmentApi.SpawnInput) {
  const executor = yield* Executor.Service
  const spawned = yield* executor.spawn(brain, input)
  return { executor, id: spawned.id, pid: spawned.pid, events: yield* executor.output(brain, spawned.id) }
})

const bun = process.execPath
const mebibyte = 1024 * 1024

const bytesOf = (events: ReadonlyArray<EnvironmentApi.ProcessEvent>, type: "stdout" | "stderr") =>
  new Uint8Array(Buffer.concat(events.flatMap((event) => (event.type === type ? [event.bytes] : []))))

const collect = (events: Stream.Stream<EnvironmentApi.ProcessEvent>) =>
  Stream.runCollect(events).pipe(
    Effect.map((all) => ({
      stdout: all.flatMap((event) => (event.type === "stdout" ? [decoder.decode(event.bytes)] : [])).join(""),
      stderr: all.flatMap((event) => (event.type === "stderr" ? [decoder.decode(event.bytes)] : [])).join(""),
      exit: all.findLast((event) => event.type === "exit"),
    })),
  )

it.live("streams stdout, stderr and the exit code", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "sh", arguments: ["-c", "echo out; echo err >&2; exit 3"] })
    expect(yield* collect(process.events)).toEqual({
      stdout: "out\n",
      stderr: "err\n",
      exit: { type: "exit", exitCode: 3, signal: null },
    })
  }),
)

it.live("writes stdout and stderr in their order to the output file, in a new folder, before the exit", () =>
  Effect.gen(function* () {
    const outputFile = join(workspace, crypto.randomUUID(), "shell", "sh_1.out")
    const process = yield* run({
      command: "sh",
      arguments: ["-c", "echo one; echo two >&2; sleep 0.1; echo three"],
      outputFile,
    })
    yield* Stream.runDrain(process.events)
    expect(yield* Effect.promise(() => Bun.file(outputFile).text())).toBe("one\ntwo\nthree\n")
  }),
)

it.live("gives a reader with a window only the last bytes it keeps, and counts the bytes and lines it left out", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const spawned = yield* executor.spawn(brain, { command: "seq", arguments: ["1", "100000"] })
    const events = yield* Stream.runCollect(
      yield* executor.output(brain, spawned.id, 0, { maxBytes: 1000, intervalMs: 100 }),
    )
    const skips = events.flatMap((event) => (event.type === "skip" ? [event] : []))
    const data = events.flatMap((event) => (event.type === "stdout" || event.type === "stderr" ? [event] : []))
    const last = data.at(-1)
    const sent = data.reduce((bytes, event) => bytes + event.bytes.length, 0)
    const newlines = (bytes: Uint8Array) => bytes.filter((byte) => byte === 10).length
    expect({
      bytes: skips.reduce((bytes, skip) => bytes + skip.length, 0) + sent,
      newlines:
        skips.reduce((count, skip) => count + skip.newlines, 0) +
        data.reduce((count, event) => count + newlines(event.bytes), 0),
      ending: last && decoder.decode(last.bytes).endsWith("99999\n100000\n"),
      exit: events.at(-1),
    }).toEqual({ bytes: 588895, newlines: 100000, ending: true, exit: { type: "exit", exitCode: 0, signal: null } })
    expect(sent).toBeLessThan(100_000)
  }),
)

it.live("refuses a spawn whose output file cannot be made, and starts no process", () =>
  Effect.gen(function* () {
    const blocker = join(workspace, `${crypto.randomUUID()}.txt`)
    yield* Effect.promise(() => writeFile(blocker, "a file, not a folder"))
    const marker = join(workspace, `${crypto.randomUUID()}.ran`)
    const executor = yield* Executor.Service
    const error = yield* executor
      .spawn(brain, { command: "touch", arguments: [marker], outputFile: join(blocker, "sh_1.out") })
      .pipe(Effect.flip)
    expect([error._tag, existsSync(marker)]).toEqual(["SpawnFailedError", false])
  }),
)

it.live("runs in the workspace with its environment and the given variables on top", () =>
  Effect.gen(function* () {
    const process = yield* run({
      command: "sh",
      arguments: ["-c", 'pwd; echo "$GREETING"; test -n "$PATH"'],
      variables: { GREETING: "hi" },
    })
    const output = yield* collect(process.events)
    expect(output.stdout).toBe(`${workspace}\nhi\n`)
    expect(output.exit).toEqual({ type: "exit", exitCode: 0, signal: null })
  }),
)

for (const shell of [
  { name: "the default shell", shell: true, command: "echo $((1 + 2))", stdout: "3\n" },
  { name: "a named shell", shell: "/bin/bash", command: 'echo "${BASH_VERSION:+bash}"', stdout: "bash\n" },
])
  it.live(`runs a command through ${shell.name}`, () =>
    Effect.gen(function* () {
      const process = yield* run({ command: shell.command, arguments: [], shell: shell.shell })
      expect((yield* collect(process.events)).stdout).toBe(shell.stdout)
    }),
  )

it.live("writes stdin and closes it", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "cat", arguments: [], hasStdin: true })
    yield* process.executor.writeStdin(brain, process.id, { data: new TextEncoder().encode("hello"), end: true })
    expect(yield* collect(process.events)).toEqual({
      stdout: "hello",
      stderr: "",
      exit: { type: "exit", exitCode: 0, signal: null },
    })
  }),
)

it.live("reports the signal that ended a process", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "sleep", arguments: ["30"] })
    yield* process.executor.kill(brain, process.id, "SIGTERM")
    expect((yield* collect(process.events)).exit).toEqual({ type: "exit", exitCode: null, signal: "SIGTERM" })
  }),
)

it.live("kills the whole group, and forces it after the delay", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "sh", arguments: ["-c", "trap '' TERM; sleep 30 & echo started; wait"] })
    const first = yield* process.events.pipe(Stream.take(1), Stream.runCollect)
    expect(first).toEqual([{ type: "stdout", offset: 0, bytes: new TextEncoder().encode("started\n") }])
    yield* process.executor.kill(brain, process.id, "SIGTERM", 200)
    const exit = yield* process.events.pipe(Stream.runLast)
    expect(exit).toEqual(Option.some({ type: "exit", exitCode: null, signal: "SIGKILL" }))
  }),
)

it.live("hides a process from other brains", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "true", arguments: [] })
    const other = Brain.ID.create()
    expect((yield* process.executor.output(other, process.id).pipe(Effect.flip))._tag).toBe("ProcessNotFoundError")
    expect((yield* process.executor.kill(other, process.id, "SIGKILL").pipe(Effect.flip))._tag).toBe(
      "ProcessNotFoundError",
    )
    expect((yield* process.executor.heartbeat(other, process.id).pipe(Effect.flip))._tag).toBe("ProcessNotFoundError")
  }),
)

it.live("keeps an exited process, so a reader that comes back after the exit still gets its output and exit", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "sh", arguments: ["-c", "echo kept; exit 5"] })
    const first = yield* collect(process.events)
    const again = yield* collect(yield* process.executor.output(brain, process.id))
    expect(again).toEqual(first)
    expect(again).toEqual({ stdout: "kept\n", stderr: "", exit: { type: "exit", exitCode: 5, signal: null } })
  }),
)

it.effect("forgets an exited process 45 seconds after its last read, and not while it is read again", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const spawned = yield* executor.spawn(brain, { command: "true", arguments: [] })
    yield* Stream.runDrain(yield* executor.output(brain, spawned.id))
    yield* TestClock.adjust(Duration.seconds(44))
    yield* Stream.runDrain(yield* executor.output(brain, spawned.id))
    yield* TestClock.adjust(Duration.seconds(44))
    expect((yield* collect(yield* executor.output(brain, spawned.id))).exit).toEqual({
      type: "exit",
      exitCode: 0,
      signal: null,
    })
    yield* TestClock.adjust(Duration.seconds(46))
    expect((yield* executor.output(brain, spawned.id).pipe(Effect.flip))._tag).toBe("ProcessNotFoundError")
  }),
)

it.live("keeps at most 64 MiB of exited output across brains and forgets the oldest first", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const finish = Effect.fnUntraced(function* () {
      const owner = Brain.ID.create()
      const spawned = yield* executor.spawn(owner, { command: "head", arguments: ["-c", "2097152", "/dev/zero"] })
      yield* Processes.exits(spawned.pid)
      yield* Stream.runDrain(Stream.take(yield* executor.output(owner, spawned.id, 2_097_152), 1))
      return { owner, id: spawned.id }
    })
    const all = yield* Effect.forEach(Array.from({ length: 33 }), () => finish())
    const found = yield* Effect.forEach(all, (entry) =>
      executor.output(entry.owner, entry.id).pipe(
        Effect.as(true),
        Effect.catchTag("ProcessNotFoundError", () => Effect.succeed(false)),
      ),
    )
    expect(found.indexOf(true)).toBe(1)
    expect(found.slice(1).every(Boolean)).toBe(true)
  }),
)

it.live("replays output from a cursor, and gives each chunk its offset", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const spawned = yield* executor.spawn(brain, {
      command: "sh",
      arguments: ["-c", "printf abc; sleep 0.3; printf def"],
    })
    const chunks = (events: ReadonlyArray<EnvironmentApi.ProcessEvent>) =>
      events.flatMap((event) =>
        event.type === "stdout" ? [{ offset: event.offset, text: decoder.decode(event.bytes) }] : [],
      )
    const all = yield* Stream.runCollect(yield* executor.output(brain, spawned.id))
    expect(chunks(all)).toEqual([
      { offset: 0, text: "abc" },
      { offset: 3, text: "def" },
    ])
    const resumed = yield* Stream.runCollect(yield* executor.output(brain, spawned.id, 2))
    expect(chunks(resumed)).toEqual([
      { offset: 2, text: "c" },
      { offset: 3, text: "def" },
    ])
    expect(resumed.at(-1)).toEqual({ type: "exit", exitCode: 0, signal: null })
    const end = yield* Stream.runCollect(yield* executor.output(brain, spawned.id, 6))
    expect(end).toEqual([{ type: "exit", exitCode: 0, signal: null }])
  }),
)

it.live("keeps the last 2 MiB of a process nobody reads, and starts a late reader at the oldest byte it kept", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const spawned = yield* executor.spawn(brain, { command: "head", arguments: ["-c", "5000000", "/dev/zero"] })
    yield* Stream.runDrain(yield* executor.output(brain, spawned.id, 5_000_000))
    const events = yield* Stream.runCollect(yield* executor.output(brain, spawned.id))
    const chunks = events.flatMap((event) => (event.type === "stdout" ? [event] : []))
    const first = chunks.at(0)
    const last = chunks.at(-1)
    expect(first?.offset).toBeGreaterThanOrEqual(5_000_000 - 2 * 1024 * 1024 - 64 * 1024)
    expect(last && last.offset + last.bytes.length).toBe(5_000_000)
    expect(events.at(-1)).toEqual({ type: "exit", exitCode: 0, signal: null })
  }),
)

it.live("holds a process back for a slow reader rather than drop output it has not read", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "head", arguments: ["-c", "5000000", "/dev/zero"] })
    const size = yield* process.events.pipe(
      Stream.tap(() => Effect.sleep(5)),
      Stream.runFold(
        () => 0,
        (total, event) => total + (event.type === "stdout" ? event.bytes.length : 0),
      ),
    )
    expect(size).toBe(5_000_000)
  }),
)

it.effect("kills a process that nobody reads or names for 30 seconds", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const spawned = yield* executor.spawn(brain, { command: "sleep", arguments: ["30"] })
    yield* TestClock.adjust(Duration.seconds(29))
    yield* executor.kill(brain, spawned.id, "SIGCONT")
    yield* TestClock.adjust(Duration.seconds(29))
    yield* executor.output(brain, spawned.id)
    yield* TestClock.adjust(Duration.seconds(31))
    expect((yield* executor.output(brain, spawned.id).pipe(Effect.flip))._tag).toBe("ProcessNotFoundError")
  }),
)

it.effect("kills a command 30 seconds after its last heartbeat, even while a reader holds it open", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const spawned = yield* executor.spawn(brain, { command: "sleep", arguments: ["120"] })
    yield* Stream.unwrap(executor.output(brain, spawned.id)).pipe(Stream.runDrain, Effect.forkScoped)
    yield* executor.heartbeat(brain, spawned.id)
    yield* Effect.forEach(
      [20, 20, 20],
      (seconds) =>
        TestClock.adjust(Duration.seconds(seconds)).pipe(Effect.andThen(executor.heartbeat(brain, spawned.id))),
      { discard: true },
    )
    yield* TestClock.adjust(Duration.seconds(31))
    expect(yield* Processes.exits(spawned.pid)).toBe(true)
    expect((yield* executor.heartbeat(brain, spawned.id).pipe(Effect.flip))._tag).toBe("ProcessNotFoundError")
  }),
)

it.live("reads, writes and lists files with OpenCode's semantics", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    yield* executor.write("notes/a.txt", new TextEncoder().encode("hello world"))
    yield* Effect.promise(() => symlink(join(workspace, "notes/a.txt"), join(workspace, "notes/link")))
    expect(decoder.decode((yield* executor.read("notes/a.txt")).bytes)).toBe("hello world")
    expect(
      decoder.decode((yield* executor.read(join(workspace, "notes/a.txt"), { offset: 6, length: 100 })).bytes),
    ).toBe("world")
    expect((yield* executor.read("notes/link")).info.type).toBe("file")
    expect((yield* executor.stat("notes/link")).type).toBe("symlink")
    expect(yield* executor.list("notes")).toEqual(
      expect.arrayContaining([
        { name: "a.txt", type: "file" },
        { name: "link", type: "symlink" },
      ]),
    )
    const directory = yield* executor.read("notes").pipe(Effect.flip)
    expect(directory._tag === "WrongKindError" && directory.actual).toBe("directory")
    const file = yield* executor.list("notes/a.txt").pipe(Effect.flip)
    expect(file._tag === "WrongKindError" && file.actual).toBe("file")
    expect((yield* executor.stat("missing").pipe(Effect.flip))._tag).toBe("FileNotFoundError")
    yield* executor.mkdir("archive/2026")
    yield* executor.move("notes/a.txt", "archive/2026")
    expect((yield* executor.stat("archive/2026/a.txt")).sizeBytes).toBe(11)
    expect((yield* executor.move("notes/a.txt", "elsewhere").pipe(Effect.flip))._tag).toBe("FileNotFoundError")
    yield* executor.remove("archive")
    yield* executor.remove("archive")
    expect((yield* executor.stat("archive").pipe(Effect.flip))._tag).toBe("FileNotFoundError")
  }),
)

it.live(
  "refuses to read a file larger than 8 MiB without a range, or to write one, and reads at most 8 MiB of a range",
  () =>
    Effect.gen(function* () {
      const executor = yield* Executor.Service
      yield* Effect.promise(() =>
        writeFile(join(workspace, "large.bin"), "").then(() =>
          truncate(join(workspace, "large.bin"), EnvironmentApi.maxFileBytes + 1),
        ),
      )
      expect((yield* executor.read("large.bin").pipe(Effect.flip))._tag).toBe("FileTooLargeError")
      expect((yield* executor.read("large.bin", { offset: 0, length: 4 })).bytes).toEqual(new Uint8Array(4))
      expect(
        (yield* executor.read("large.bin", { offset: 0, length: EnvironmentApi.maxFileBytes + 1 })).bytes.length,
      ).toBe(EnvironmentApi.maxFileBytes)
      expect(
        (yield* executor.write("copy.bin", new Uint8Array(EnvironmentApi.maxFileBytes + 1)).pipe(Effect.flip))._tag,
      ).toBe("FileTooLargeError")
      expect((yield* executor.stat("copy.bin").pipe(Effect.flip))._tag).toBe("FileNotFoundError")
    }),
)

const archives = Effect.fnUntraced(function* (
  folders: Readonly<Record<string, (root: string) => Promise<void>>>,
  options: { readonly together?: number } = {},
) {
  const source = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "ren-archive-")))
  yield* Effect.forEach(Object.entries(folders), (entry) =>
    Effect.promise(async () => {
      const root = join(source, entry[0], "repo-c1")
      await mkdir(root, { recursive: true })
      await entry[1](root)
      const packed = Bun.spawnSync(
        ["tar", "-czf", join(source, `${entry[0]}.tar.gz`), "-C", join(source, entry[0]), "repo-c1"],
        {
          env: { ...process.env, COPYFILE_DISABLE: "1" },
        },
      )
      if (packed.exitCode !== 0) throw new Error(packed.stderr.toString())
    }),
  )
  const requests: Array<string> = []
  const authorizations: Array<string | null> = []
  const arrived = Promise.withResolvers<void>()
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: async (request) => {
          const name = new URL(request.url).pathname.slice(1)
          requests.push(name)
          authorizations.push(request.headers.get("authorization"))
          if (requests.length >= (options.together ?? 1)) arrived.resolve()
          await arrived.promise
          const file = Bun.file(join(source, name))
          return (await file.exists()) ? new Response(file) : new Response("missing", { status: 404 })
        },
      }),
    ),
    (served) => Effect.promise(() => served.stop(true)),
  )
  return {
    url: (name: string) => `http://127.0.0.1:${server.port}/${name}`,
    requests: () => [...requests],
    authorizations: () => [...authorizations],
  }
})

const put = (path: string, text: string) =>
  mkdir(join(path, ".."), { recursive: true }).then(() => writeFile(path, text))

it.live(
  "unpacks only an archive's folder, makes the path appear whole, and downloads nothing for a path that exists",
  () =>
    Effect.gen(function* () {
      const executor = yield* Executor.Service
      const served = yield* archives({
        skills: async (root) => {
          await put(join(root, "skills/pdf/SKILL.md"), "body")
          await put(join(root, "skills/pdf/scripts/fill.sh"), "echo fill\n")
          await put(join(root, "skills/pdf/empty.txt"), "")
          await put(join(root, "README.md"), "repository")
        },
      })
      yield* executor.unpack({ url: served.url("skills.tar.gz"), folder: "skills/pdf", path: "unpacked/pdf/c1" })
      const target = join(workspace, "unpacked/pdf/c1")
      expect(
        yield* Effect.promise(() =>
          Promise.all(["SKILL.md", "scripts/fill.sh", "empty.txt"].map((name) => Bun.file(join(target, name)).text())),
        ),
      ).toEqual(["body", "echo fill\n", ""])
      expect(existsSync(join(target, "README.md"))).toBe(false)
      yield* executor.unpack({ url: served.url("skills.tar.gz"), folder: "skills/pdf", path: "unpacked/pdf/c1" })
      expect(served.requests()).toEqual(["skills.tar.gz"])
    }),
)

it.live("an archive with a link or a download that fails leaves nothing at the path", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const served = yield* archives({
      linked: async (root) => {
        await put(join(root, "SKILL.md"), "body")
        await symlink("/etc/passwd", join(root, "escape"))
      },
    })
    const linked = yield* executor
      .unpack({ url: served.url("linked.tar.gz"), folder: ".", path: "refused/linked" })
      .pipe(Effect.flip)
    expect(linked.message).toBe("The archive has a link at escape, and the executor copies only files")
    const missing = yield* executor
      .unpack({ url: served.url("missing.tar.gz"), folder: ".", path: "refused/missing" })
      .pipe(Effect.flip)
    expect(missing.message).toBe("The archive answered 404")
    expect(yield* Effect.promise(() => readdir(join(workspace, "refused")).catch(() => []))).toEqual([])
  }),
)

it.live("two unpacks of one path at the same time both succeed", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const served = yield* archives({ docs: (root) => put(join(root, "README.md"), "docs") }, { together: 2 })
    const input = { url: served.url("docs.tar.gz"), folder: ".", path: "together/docs/c1" }
    yield* Effect.all([executor.unpack(input), executor.unpack(input)], { concurrency: "unbounded" })
    expect(served.requests()).toEqual(["docs.tar.gz", "docs.tar.gz"])
    expect(yield* Effect.promise(() => Bun.file(join(workspace, "together/docs/c1/README.md")).text())).toBe("docs")
    expect(yield* Effect.promise(() => readdir(join(workspace, "together/docs")))).toEqual(["c1"])
  }),
)

it.live("an unpack that skips links leaves the link out and sends the caller's headers", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const served = yield* archives({
      linked: async (root) => {
        await put(join(root, "README.md"), "docs")
        await symlink("/etc/passwd", join(root, "escape"))
      },
    })
    yield* executor.unpack({
      url: served.url("linked.tar.gz"),
      folder: ".",
      path: "skipped/linked",
      headers: { authorization: "Bearer ren:GITHUB" },
      links: "skip",
    })
    expect(yield* Effect.promise(() => readdir(join(workspace, "skipped/linked")))).toEqual(["README.md"])
    expect(served.authorizations()).toEqual(["Bearer ren:GITHUB"])
  }),
)

it.effect("kills the whole group of a process that nobody reads or names for 30 seconds", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const spawned = yield* executor.spawn(brain, { command: "sh", arguments: ["-c", "sleep 60 & echo $!; wait"] })
    const first = yield* Stream.unwrap(executor.output(brain, spawned.id)).pipe(Stream.take(1), Stream.runCollect)
    const event = first.at(0)
    const grandchild = Number(event?.type === "stdout" ? decoder.decode(event.bytes) : Number.NaN)
    expect(Processes.running(grandchild)).toBe(true)
    yield* TestClock.adjust(Duration.seconds(31))
    expect(yield* Processes.exits(grandchild)).toBe(true)
    expect((yield* executor.output(brain, spawned.id).pipe(Effect.flip))._tag).toBe("ProcessNotFoundError")
  }),
)

it.live("gives every reader every event", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const spawned = yield* executor.spawn(brain, {
      command: "sh",
      arguments: ["-c", "sleep 0.3; echo one; echo two >&2; exit 4"],
    })
    const readers = yield* Effect.all([executor.output(brain, spawned.id), executor.output(brain, spawned.id)])
    const expected = { stdout: "one\n", stderr: "two\n", exit: { type: "exit" as const, exitCode: 4, signal: null } }
    expect(yield* Effect.all(readers.map(collect), { concurrency: "unbounded" })).toEqual([expected, expected])
  }),
)

it.live("takes a megabyte of stdin in writes larger than its buffer", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "wc", arguments: ["-c"], hasStdin: true })
    const chunk = new Uint8Array(64 * 1024)
    yield* Effect.forEach(
      Array.from({ length: 16 }, () => chunk),
      (bytes) => process.executor.writeStdin(brain, process.id, { data: bytes, end: false }),
      { discard: true },
    )
    yield* process.executor.writeStdin(brain, process.id, { data: new Uint8Array(), end: true })
    expect((yield* collect(process.events)).stdout.trim()).toBe(String(16 * 64 * 1024))
  }),
)

it.live("refuses stdin at once while the process's stdin queue is full, and takes it again once it drains", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "sh", arguments: ["-c", "read -r go; cat >/dev/null"], hasStdin: true })
    yield* Effect.forEach(
      Array.from({ length: 16 }, () => encoder.encode("x")),
      (bytes) => process.executor.writeStdin(brain, process.id, { data: bytes, end: false }),
      { discard: true },
    )
    const full = yield* process.executor
      .writeStdin(brain, process.id, { data: encoder.encode("y"), end: false })
      .pipe(Effect.flip)
    expect(full._tag).toBe("StdinFullError")
    yield* process.executor.kill(brain, process.id, "SIGKILL")
    expect((yield* collect(process.events)).exit).toEqual({ type: "exit", exitCode: null, signal: "SIGKILL" })
  }),
)

it.live("refuses stdin after it was closed", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "sh", arguments: ["-c", "cat; sleep 0.5"], hasStdin: true })
    yield* process.executor.writeStdin(brain, process.id, { data: encoder.encode("a"), end: true })
    const error = yield* process.executor
      .writeStdin(brain, process.id, { data: encoder.encode("b"), end: false })
      .pipe(Effect.flip)
    expect(error._tag).toBe("StdinClosedError")
    expect((yield* collect(process.events)).stdout).toBe("a")
  }),
)

it.live("accepts a kill for a process that exited before anyone read its exit", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "true", arguments: [] })
    yield* Processes.exits(process.pid)
    yield* process.executor.kill(brain, process.id, "SIGTERM")
    expect((yield* collect(process.events)).exit).toEqual({ type: "exit", exitCode: 0, signal: null })
  }),
)

it.live("kills every process group when it shuts down", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const own = Context.get(yield* Layer.buildWithScope(Layer.fresh(executor), scope), Executor.Service)
    const spawned = yield* own.spawn(brain, { command: "sh", arguments: ["-c", "sleep 60 & echo $!; wait"] })
    const first = yield* Stream.unwrap(own.output(brain, spawned.id)).pipe(Stream.take(1), Stream.runCollect)
    const event = first.at(0)
    const grandchild = Number(event?.type === "stdout" ? decoder.decode(event.bytes) : Number.NaN)
    expect(Processes.running(grandchild)).toBe(true)
    yield* Scope.close(scope, Exit.void)
    expect(yield* Processes.exits(spawned.pid)).toBe(true)
    expect(yield* Processes.exits(grandchild)).toBe(true)
  }),
)

it.live("fails to spawn a command that does not exist", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const error = yield* executor.spawn(brain, { command: "ren-no-such-command", arguments: [] }).pipe(Effect.flip)
    expect(error._tag).toBe("SpawnFailedError")
  }),
)

it.effect("a reader that stops reading holds a command back only until it stalls, then the command runs on", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const spawned = yield* executor.spawn(brain, { command: "head", arguments: ["-c", "10000000", "/dev/zero"] })
    const reached = yield* Deferred.make<void>()
    yield* Stream.unwrap(executor.output(brain, spawned.id)).pipe(
      Stream.tap(() => Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never))),
      Stream.runDrain,
      Effect.forkScoped,
    )
    yield* Deferred.await(reached)
    const exit = yield* Stream.runLast(Stream.unwrap(executor.output(brain, spawned.id, 10_000_000))).pipe(
      Effect.forkScoped,
    )
    const exited = yield* executor
      .heartbeat(brain, spawned.id)
      .pipe(
        Effect.ignore,
        Effect.andThen(TestClock.adjust(Duration.seconds(16))),
        Effect.andThen(TestClock.withLive(Fiber.join(exit).pipe(Effect.timeoutOption(Duration.millis(200))))),
        Effect.repeat({ until: Option.isSome, times: 10 }),
      )
    expect(exited).toEqual(Option.some(Option.some({ type: "exit", exitCode: 0, signal: null })))
    const late = yield* Stream.runCollect(Stream.unwrap(executor.output(brain, spawned.id)))
    const kept = late.flatMap((event) => (event.type === "stdout" ? [event] : []))
    const last = kept.at(-1)
    expect(last && last.offset + last.bytes.length).toBe(10_000_000)
    expect(late.at(-1)).toEqual({ type: "exit", exitCode: 0, signal: null })
  }),
)

it.live("lists the shells the machine has, its own default first", () =>
  Effect.gen(function* () {
    const shells = (yield* Executor.Service).hello.shells ?? []
    expect(shells.length).toBeGreaterThan(0)
    expect(shells.filter((shell) => !Bun.which(shell))).toEqual([])
    expect(new Set(shells).size).toBe(shells.length)
    if (process.env.SHELL) expect(shells.at(0)).toBe(process.env.SHELL)
  }),
)

it.live("fails to spawn in a directory that does not exist, and leaves no process", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const marker = `ren-f5-${crypto.randomUUID()}`
    const sleeping = (directory: string) => ({ command: "sh", arguments: ["-c", "sleep 30; true", marker], directory })
    const error = yield* executor.spawn(brain, sleeping("no-such-directory")).pipe(Effect.flip)
    expect(error._tag).toBe("SpawnFailedError")
    expect(Processes.matching(marker)).toEqual([])
    const control = yield* executor.spawn(brain, sleeping("."))
    expect(Processes.matching(marker)).not.toEqual([])
    yield* executor.kill(brain, control.id, "SIGKILL")
  }),
)

it.live("passes each argument as it is without a shell, and leaves quoting to the shell with one", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const args = ["a b", `it's "quoted"`, "line\nbreak", "héllo ✓ 😀", "", "$HOME", "*"]
    const split = (stdout: string) => stdout.split("\0").slice(0, -1)
    const direct = yield* run({ command: "printf", arguments: ["%s\\0", ...args], variables: { HOME: "/nowhere" } })
    expect(split((yield* collect(direct.events)).stdout)).toEqual(args)
    const shelled = yield* executor.spawn(brain, {
      command: `printf '%s\\0' "$GREETING" 'a b' "it's" $GREETING`,
      arguments: [],
      variables: { GREETING: "x  y" },
      shell: true,
    })
    expect(split((yield* collect(yield* executor.output(brain, shelled.id))).stdout)).toEqual([
      "x  y",
      "a b",
      "it's",
      "x",
      "y",
    ])
  }),
)

it.live("fails with a typed error for an argument of 1 MiB or with a NUL byte, and keeps spawning", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const huge = yield* executor.spawn(brain, { command: "echo", arguments: ["a".repeat(mebibyte)] }).pipe(Effect.flip)
    expect(huge._tag).toBe("SpawnFailedError")
    const nul = yield* executor.spawn(brain, { command: "echo", arguments: ["a\0b"] }).pipe(Effect.flip)
    expect(nul._tag).toBe("SpawnFailedError")
    const process = yield* run({ command: "echo", arguments: ["still serving"] })
    expect((yield* collect(process.events)).stdout).toBe("still serving\n")
  }),
)

it.live("gives the process variables with unicode, empty values and a new PATH as they are", () =>
  Effect.gen(function* () {
    yield* Effect.promise(async () => {
      await mkdir(join(workspace, "f8-bin"), { recursive: true })
      await writeFile(join(workspace, "f8-bin/hello-ren"), "#!/bin/sh\necho from-new-path\n", { mode: 0o755 })
    })
    const variables = {
      UNICODE: "héllo ✓ 😀",
      EMPTY: "",
      PATH: `${join(workspace, "f8-bin")}:${process.env.PATH}`,
    }
    const shell = yield* run({
      command: "sh",
      arguments: ["-c", 'printf "%s|%s|" "$UNICODE" "${EMPTY-unset}"; hello-ren'],
      variables,
    })
    expect((yield* collect(shell.events)).stdout).toBe("héllo ✓ 😀||from-new-path\n")
    const direct = yield* run({ command: "hello-ren", arguments: [], variables })
    expect((yield* collect(direct.events)).stdout).toBe("from-new-path\n")
  }),
)

it.live("fails to spawn a command file with no execute permission with a typed error", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    yield* Effect.promise(() => writeFile(join(workspace, "no-execute.sh"), "#!/bin/sh\necho hi\n", { mode: 0o644 }))
    const error = yield* executor
      .spawn(brain, { command: join(workspace, "no-execute.sh"), arguments: [] })
      .pipe(Effect.flip)
    expect(error._tag).toBe("SpawnFailedError")
    expect(error.message).toContain("PermissionDenied")
  }),
)

it.live("refuses stdin for a process that was started without stdin", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "sleep", arguments: ["30"] })
    for (const end of [false, true]) {
      const error = yield* process.executor
        .writeStdin(brain, process.id, { data: encoder.encode("x"), end })
        .pipe(Effect.flip)
      expect(error._tag).toBe("StdinClosedError")
    }
    yield* process.executor.kill(brain, process.id, "SIGKILL")
  }),
)

it.live("refuses stdin at once for a process that exited", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const errors = yield* Effect.forEach(
      Array.from({ length: 30 }),
      () =>
        Effect.gen(function* () {
          const spawned = yield* executor.spawn(brain, { command: "true", arguments: [], hasStdin: true })
          yield* Stream.runDrain(yield* executor.output(brain, spawned.id))
          return (yield* executor
            .writeStdin(brain, spawned.id, { data: encoder.encode("late"), end: false })
            .pipe(Effect.flip))._tag
        }),
      { concurrency: 1 },
    )
    expect(errors).toEqual(Array(30).fill("StdinClosedError"))
  }),
)

it.live("gives a process with no stdin the end of input at once", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "cat", arguments: [] })
    expect(yield* collect(process.events)).toEqual({
      stdout: "",
      stderr: "",
      exit: { type: "exit", exitCode: 0, signal: null },
    })
  }),
)

it.live("closes stdin with a write of 0 bytes and the end flag", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "cat", arguments: [], hasStdin: true })
    yield* process.executor.writeStdin(brain, process.id, { data: new Uint8Array(), end: true })
    expect(yield* collect(process.events)).toEqual({
      stdout: "",
      stderr: "",
      exit: { type: "exit", exitCode: 0, signal: null },
    })
  }),
)

it.live("gives the process the data of a write with the end flag before the end of input", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "sh", arguments: ["-c", "sleep 0.3; cat"], hasStdin: true })
    const lines = Array.from({ length: 15 }, (_, index) => `line ${index}\n`)
    yield* Effect.forEach(
      lines,
      (line) => process.executor.writeStdin(brain, process.id, { data: encoder.encode(line), end: false }),
      {
        discard: true,
      },
    )
    yield* process.executor.writeStdin(brain, process.id, { data: encoder.encode("last\n"), end: true })
    expect((yield* collect(process.events)).stdout).toBe(`${lines.join("")}last\n`)
  }),
)

it.live("gives binary output byte for byte, all 256 values", () =>
  Effect.gen(function* () {
    const process = yield* run({
      command: bun,
      arguments: ["-e", "await Bun.write(Bun.stdout, Uint8Array.from({ length: 256 }, (_, index) => index))"],
    })
    const events = yield* Stream.runCollect(process.events)
    expect(bytesOf(events, "stdout")).toEqual(Uint8Array.from({ length: 256 }, (_, index) => index))
  }),
)

it.live("streams 50 MB to a reader and keeps only the last 2 MiB of it", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    Bun.gc(true)
    const before = process.memoryUsage().arrayBuffers
    const spawned = yield* executor.spawn(brain, { command: "sh", arguments: ["-c", "yes | head -c 52428800"] })
    const received = yield* (yield* executor.output(brain, spawned.id)).pipe(
      Stream.runFold(
        () => 0,
        (total, event) => total + (event.type === "stdout" ? event.bytes.length : 0),
      ),
    )
    expect(received).toBe(50 * mebibyte)
    Bun.gc(true)
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(3 * mebibyte)
  }),
)

it.live("gives output with no new line, with only carriage returns, and one line of 10 MiB as it is", () =>
  Effect.gen(function* () {
    const output = Effect.fnUntraced(function* (script: string) {
      const process = yield* run({ command: "sh", arguments: ["-c", script] })
      return bytesOf([...(yield* Stream.runCollect(process.events))], "stdout")
    })
    expect(decoder.decode(yield* output("printf abc"))).toBe("abc")
    expect(decoder.decode(yield* output("printf 'a\\rb\\rc\\r'"))).toBe("a\rb\rc\r")
    const line = yield* output("head -c 10485760 /dev/zero | tr '\\0' a")
    expect(line.length).toBe(10 * mebibyte)
    expect(line).toEqual(new Uint8Array(10 * mebibyte).fill(97))
  }),
)

it.live("counts stdout and stderr in one offset sequence and keeps the order inside each stream", () =>
  Effect.gen(function* () {
    const process = yield* run({
      command: "sh",
      arguments: ["-c", "i=0; while [ $i -lt 200 ]; do echo out$i; echo err$i >&2; i=$((i+1)); done"],
    })
    const events = [...(yield* Stream.runCollect(process.events))]
    const chunks = events.flatMap((event) => (event.type === "stdout" || event.type === "stderr" ? [event] : []))
    const ordered = chunks.toSorted((a, b) => a.offset - b.offset)
    expect(ordered.map((chunk) => chunk.offset)).toEqual(
      ordered.map((_, index) => ordered.slice(0, index).reduce((total, chunk) => total + chunk.bytes.length, 0)),
    )
    const lines = (prefix: string) => Array.from({ length: 200 }, (_, index) => `${prefix}${index}\n`).join("")
    expect(decoder.decode(bytesOf(events, "stdout"))).toBe(lines("out"))
    expect(decoder.decode(bytesOf(events, "stderr"))).toBe(lines("err"))
  }),
)

it.live("gives the stderr of a command that closed its stdout, then the exit", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "sh", arguments: ["-c", "exec >&-; sleep 0.3; echo x >&2"] })
    const events = yield* Stream.runCollect(process.events)
    expect(events.map((event) => event.type)).toEqual(["stderr", "exit"])
    expect(decoder.decode(bytesOf(events, "stderr"))).toBe("x\n")
  }),
)

it.live("ends a command whose background child keeps stdout open when that child lets go, as a local run does", () =>
  Effect.gen(function* () {
    const script = "sleep 2 & echo done"
    const startedAt = Date.now()
    const local = Bun.spawn(["sh", "-c", script], { stdout: "pipe", stderr: "ignore" })
    const localOutput = yield* Effect.promise(() => new Response(local.stdout).text())
    const localMs = Date.now() - startedAt
    const process = yield* run({ command: "sh", arguments: ["-c", script] })
    const remoteStartedAt = Date.now()
    const remote = yield* collect(process.events)
    const remoteMs = Date.now() - remoteStartedAt
    expect(remote).toEqual({ stdout: localOutput, stderr: "", exit: { type: "exit", exitCode: 0, signal: null } })
    expect(localMs).toBeGreaterThanOrEqual(1500)
    expect(remoteMs).toBeGreaterThanOrEqual(1500)
  }),
)

it.live("gives the exit after all the output", () =>
  Effect.gen(function* () {
    const process = yield* run({
      command: "sh",
      arguments: ["-c", "head -c 1000000 /dev/zero; head -c 1000000 /dev/zero >&2; echo end"],
    })
    const events = [...(yield* Stream.runCollect(process.events))]
    expect(events.filter((event) => event.type === "exit")).toHaveLength(1)
    expect(events.at(-1)?.type).toBe("exit")
    expect(bytesOf(events, "stdout").length + bytesOf(events, "stderr").length).toBe(2_000_004)
  }),
)

it.live("waits for new output when the cursor is after the end", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "cat", arguments: [], hasStdin: true })
    const seen = yield* Deferred.make<void>()
    const early = yield* Stream.unwrap(process.executor.output(brain, process.id, 4)).pipe(
      Stream.tap(() => Deferred.succeed(seen, undefined)),
      Stream.takeUntil((event) => event.type === "exit"),
      Stream.runCollect,
      Effect.forkScoped,
    )
    const everything = yield* Stream.unwrap(process.executor.output(brain, process.id)).pipe(
      Stream.takeUntil((event) => event.type === "stdout" && event.bytes.length > 0),
      Stream.runCollect,
      Effect.forkScoped,
    )
    yield* process.executor.writeStdin(brain, process.id, { data: encoder.encode("abc"), end: false })
    yield* Fiber.join(everything)
    yield* Effect.yieldNow
    expect(yield* Deferred.isDone(seen)).toBe(false)
    yield* process.executor.writeStdin(brain, process.id, { data: encoder.encode("de"), end: true })
    expect([...(yield* Fiber.join(early))]).toEqual([
      { type: "stdout", offset: 4, bytes: encoder.encode("e") },
      { type: "exit", exitCode: 0, signal: null },
    ])
  }),
)

it.live("gives a second reader from cursor 0 the first byte that is kept, and the offset tells the gap", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "head", arguments: ["-c", String(3 * mebibyte), "/dev/zero"] })
    yield* Stream.runDrain(process.events)
    const events = [...(yield* Stream.runCollect(yield* process.executor.output(brain, process.id)))]
    const chunks = events.flatMap((event) => (event.type === "stdout" ? [event] : []))
    const kept = chunks.reduce((total, chunk) => total + chunk.bytes.length, 0)
    expect(chunks.at(0)?.offset).toBe(3 * mebibyte - kept)
    expect(chunks.at(0)?.offset).toBeGreaterThan(0)
    expect(kept).toBeLessThanOrEqual(2 * mebibyte + 64 * 1024)
    expect(events.at(-1)).toEqual({ type: "exit", exitCode: 0, signal: null })
  }),
)

it.live("reports a signal that the process sent to itself", () =>
  Effect.gen(function* () {
    const exits = yield* Effect.forEach(["TERM", "INT", "KILL"], (name) =>
      run({ command: "sh", arguments: ["-c", `kill -s ${name} $$`] }).pipe(
        Effect.flatMap((process) => collect(process.events)),
        Effect.map((output) => output.exit),
      ),
    )
    expect(exits).toEqual([
      { type: "exit", exitCode: null, signal: "SIGTERM" },
      { type: "exit", exitCode: null, signal: "SIGINT" },
      { type: "exit", exitCode: null, signal: "SIGKILL" },
    ])
  }),
)

it.live("accepts a second stop of a process that is already stopping, and one after its exit", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "sleep", arguments: ["30"] })
    yield* process.executor.kill(brain, process.id, "SIGTERM")
    yield* process.executor.kill(brain, process.id, "SIGTERM")
    expect((yield* collect(process.events)).exit).toEqual({ type: "exit", exitCode: null, signal: "SIGTERM" })
    yield* process.executor.kill(brain, process.id, "SIGTERM")
  }),
)

it.live("does not stop a process that started its own session (setsid): it outlives the stop (D8, recorded)", () =>
  Effect.gen(function* () {
    const parent = yield* run({
      command: bun,
      arguments: [
        "-e",
        "const child = Bun.spawn(['sleep', '60'], { detached: true, stdio: ['ignore', 'ignore', 'ignore'] }); child.unref(); console.log(child.pid); await Bun.sleep(60000)",
      ],
    })
    const first = (yield* Stream.runCollect(parent.events.pipe(Stream.take(1)))).at(0)
    const escaped = Number(first?.type === "stdout" ? decoder.decode(first.bytes) : Number.NaN)
    yield* Effect.gen(function* () {
      expect(Processes.running(escaped)).toBe(true)
      yield* parent.executor.kill(brain, parent.id, "SIGKILL")
      expect(yield* Processes.exits(parent.pid)).toBe(true)
      expect(Processes.running(escaped)).toBe(true)
    }).pipe(Effect.ensuring(Effect.sync(() => process.kill(escaped, "SIGKILL"))))
  }),
)

it.live("reaps the children of 100 commands that each start a child, and leaves no zombie", () =>
  Effect.gen(function* () {
    const outputs = yield* Effect.forEach(
      Array.from({ length: 100 }),
      () =>
        run({ command: "sh", arguments: ["-c", "sleep 0.05 & wait"] }).pipe(
          Effect.flatMap((process) => collect(process.events)),
        ),
      { concurrency: 25 },
    )
    expect(outputs.map((output) => output.exit?.exitCode)).toEqual(Array(100).fill(0))
    expect(Processes.zombies()).toBe(0)
  }),
)

it.effect("stops a command while the producer waits for a stalled reader, and the reader gets the exit", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const spawned = yield* executor.spawn(brain, { command: "head", arguments: ["-c", "10000000", "/dev/zero"] })
    const reached = yield* Deferred.make<void>()
    yield* Stream.unwrap(executor.output(brain, spawned.id)).pipe(
      Stream.tap(() => Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never))),
      Stream.runDrain,
      Effect.forkScoped,
    )
    yield* Deferred.await(reached)
    const exit = yield* Stream.runLast(Stream.unwrap(executor.output(brain, spawned.id, 10_000_000))).pipe(
      Effect.forkScoped,
    )
    yield* executor.kill(brain, spawned.id, "SIGKILL")
    expect(yield* Processes.exits(spawned.pid)).toBe(true)
    const exited = yield* TestClock.adjust(Duration.seconds(16)).pipe(
      Effect.andThen(TestClock.withLive(Fiber.join(exit).pipe(Effect.timeoutOption(Duration.millis(200))))),
      Effect.repeat({ until: Option.isSome, times: 10 }),
    )
    expect(exited).toEqual(Option.some(Option.some({ type: "exit", exitCode: null, signal: "SIGKILL" })))
  }),
)

it.effect("holds a command back for a stalled reader at 14 seconds, and runs on without it at 16", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const spawned = yield* executor.spawn(brain, { command: "head", arguments: ["-c", "10000000", "/dev/zero"] })
    const reached = yield* Deferred.make<void>()
    yield* Stream.unwrap(executor.output(brain, spawned.id)).pipe(
      Stream.tap(() => Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never))),
      Stream.runDrain,
      Effect.forkScoped,
    )
    yield* Deferred.await(reached)
    const exit = yield* Stream.runLast(Stream.unwrap(executor.output(brain, spawned.id, 10_000_000))).pipe(
      Effect.forkScoped,
    )
    yield* TestClock.adjust(Duration.seconds(14))
    expect(yield* TestClock.withLive(Fiber.join(exit).pipe(Effect.timeoutOption(Duration.millis(200))))).toEqual(
      Option.none(),
    )
    const exited = yield* TestClock.adjust(Duration.seconds(2)).pipe(
      Effect.andThen(TestClock.withLive(Fiber.join(exit).pipe(Effect.timeoutOption(Duration.millis(200))))),
      Effect.repeat({ until: Option.isSome, times: 10 }),
    )
    expect(exited).toEqual(Option.some(Option.some({ type: "exit", exitCode: 0, signal: null })))
  }),
)

it.effect(
  "gives a second reader its whole output while the producer waits for a stalled reader, with no deadlock",
  () =>
    Effect.gen(function* () {
      const executor = yield* Executor.Service
      const spawned = yield* executor.spawn(brain, { command: "head", arguments: ["-c", "10000000", "/dev/zero"] })
      const reached = yield* Deferred.make<void>()
      yield* Stream.unwrap(executor.output(brain, spawned.id)).pipe(
        Stream.tap(() => Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never))),
        Stream.runDrain,
        Effect.forkScoped,
      )
      yield* Deferred.await(reached)
      const second = yield* Stream.unwrap(executor.output(brain, spawned.id)).pipe(
        Stream.runFold(
          () => ({ bytes: 0, end: false }),
          (total, event) => ({
            bytes: total.bytes + (event.type === "stdout" ? event.bytes.length : 0),
            end: total.end || event.type === "exit",
          }),
        ),
        Effect.forkScoped,
      )
      const finished = yield* executor
        .heartbeat(brain, spawned.id)
        .pipe(
          Effect.ignore,
          Effect.andThen(TestClock.adjust(Duration.seconds(16))),
          Effect.andThen(TestClock.withLive(Fiber.join(second).pipe(Effect.timeoutOption(Duration.millis(200))))),
          Effect.repeat({ until: Option.isSome, times: 20 }),
        )
      expect(finished).toEqual(Option.some({ bytes: 10_000_000, end: true }))
    }),
)

it.live("gives a reader that comes back after the exit, or while it exits, the rest of the output and the exit", () =>
  Effect.gen(function* () {
    const start = Effect.fnUntraced(function* () {
      const process = yield* run({ command: "cat", arguments: [], hasStdin: true })
      yield* process.executor.writeStdin(brain, process.id, { data: encoder.encode("abc"), end: false })
      yield* process.events.pipe(
        Stream.takeUntil((event) => event.type === "stdout"),
        Stream.runDrain,
      )
      return process
    })
    const after = yield* start()
    yield* after.executor.writeStdin(brain, after.id, { data: new Uint8Array(), end: true })
    yield* Processes.exits(after.pid)
    expect([...(yield* Stream.runCollect(yield* after.executor.output(brain, after.id, 3)))]).toEqual([
      { type: "exit", exitCode: 0, signal: null },
    ])
    const tails = yield* Effect.forEach(
      Array.from({ length: 20 }),
      () =>
        Effect.gen(function* () {
          const racing = yield* start()
          const both = yield* Effect.all(
            [
              racing.executor.writeStdin(brain, racing.id, { data: new Uint8Array(), end: true }),
              Effect.flatMap(racing.executor.output(brain, racing.id, 3), Stream.runCollect),
            ],
            { concurrency: "unbounded" },
          )
          return [...both[1]]
        }),
      { concurrency: 1 },
    )
    expect(tails).toEqual(Array(20).fill([{ type: "exit", exitCode: 0, signal: null }]))
  }),
)

it.effect("alive at 29 seconds and stopped at 31 with no reader and no name", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const spawned = yield* executor.spawn(brain, { command: "sleep", arguments: ["120"] })
    yield* TestClock.adjust(Duration.seconds(29))
    expect(Processes.running(spawned.pid)).toBe(true)
    yield* TestClock.adjust(Duration.seconds(2))
    expect(yield* Processes.exits(spawned.pid)).toBe(true)
    expect((yield* executor.heartbeat(brain, spawned.id).pipe(Effect.flip))._tag).toBe("ProcessNotFoundError")
  }),
)

it.effect("ends the stream of a reader whose command the sweep stops, and does not leave it waiting", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const unread = yield* executor.spawn(brain, { command: "sleep", arguments: ["120"] })
    const held = yield* executor.output(brain, unread.id)
    const heartbeating = yield* executor.spawn(brain, { command: "sleep", arguments: ["120"] })
    yield* executor.heartbeat(brain, heartbeating.id)
    const attached = yield* Stream.unwrap(executor.output(brain, heartbeating.id)).pipe(
      Stream.runDrain,
      Effect.exit,
      Effect.forkScoped,
    )
    yield* TestClock.adjust(Duration.seconds(31))
    expect(yield* Processes.exits(unread.pid)).toBe(true)
    expect(yield* Processes.exits(heartbeating.pid)).toBe(true)
    const ended = yield* TestClock.withLive(
      Effect.all([Stream.runDrain(held).pipe(Effect.exit), Fiber.join(attached)]).pipe(
        Effect.timeoutOption(Duration.seconds(1)),
      ),
    )
    expect(Option.isSome(ended)).toBe(true)
  }),
)

it.effect("forgets a completed command that nobody reads 45 seconds after its exit", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const spawned = yield* executor.spawn(brain, { command: "true", arguments: [] })
    yield* Processes.exits(spawned.pid)
    yield* TestClock.withLive(Effect.sleep(Duration.millis(200)))
    yield* TestClock.adjust(Duration.seconds(46))
    expect((yield* executor.output(brain, spawned.id).pipe(Effect.flip))._tag).toBe("ProcessNotFoundError")
  }),
)

it.live(
  "completes 200 commands from 10 brains at the same time, and gives back its file descriptors",
  () =>
    Effect.gen(function* () {
      const executor = yield* Executor.Service
      const start = Processes.openFiles()
      const commands = Array.from({ length: 10 }, () => Brain.ID.create()).flatMap((owner, index) =>
        Array.from({ length: 20 }, (_, count) => ({ owner, number: index * 20 + count })),
      )
      const outputs = yield* Effect.forEach(
        commands,
        (command) =>
          Effect.gen(function* () {
            const spawned = yield* executor.spawn(command.owner, {
              command: "sh",
              arguments: ["-c", `sleep 0.2; echo ${command.number}`],
            })
            return yield* collect(yield* executor.output(command.owner, spawned.id))
          }),
        { concurrency: "unbounded" },
      )
      expect(outputs).toEqual(
        commands.map((command) => ({
          stdout: `${command.number}\n`,
          stderr: "",
          exit: { type: "exit", exitCode: 0, signal: null },
        })),
      )
      expect(Processes.openFiles()).toBe(start)
    }),
  30_000,
)

it.effect(
  "runs 1000 short commands twice, and gives back its file descriptors and heap objects the second time",
  () =>
    Effect.gen(function* () {
      const executor = yield* Executor.Service
      const short = Effect.gen(function* () {
        const command = yield* executor.spawn(brain, { command: "echo", arguments: ["x"] })
        yield* Stream.runDrain(yield* executor.output(brain, command.id))
        return command
      })
      const batch = Effect.gen(function* () {
        const first = yield* short
        yield* Effect.forEach(Array.from({ length: 999 }), () => short, { concurrency: 1, discard: true })
        yield* TestClock.adjust(Duration.seconds(46))
        expect((yield* executor.output(brain, first.id).pipe(Effect.flip))._tag).toBe("ProcessNotFoundError")
        Bun.gc(true)
        return heapStats().objectCount
      })
      const warm = yield* batch
      const files = Processes.openFiles()
      const second = yield* batch
      expect(Processes.openFiles()).toBe(files)
      expect(second - warm).toBeLessThan(5000)
    }),
  60_000,
)

it.live("reads an empty file as no bytes", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    yield* executor.write("empty.txt", new Uint8Array())
    const read = yield* executor.read("empty.txt")
    expect(read.bytes).toEqual(new Uint8Array())
    expect(read.info.sizeBytes).toBe(0)
  }),
)

if (process.getuid?.() !== 0)
  it.live("gives a typed error for a file with no read permission", () =>
    Effect.gen(function* () {
      const executor = yield* Executor.Service
      yield* executor.write("secret.txt", encoder.encode("secret"))
      yield* Effect.promise(() => chmod(join(workspace, "secret.txt"), 0o000))
      const whole = yield* executor.read("secret.txt").pipe(Effect.flip)
      expect(whole._tag).toBe("FileSystemError")
      expect(whole._tag === "FileSystemError" && whole.message).toContain("EACCES")
      expect((yield* executor.read("secret.txt", { offset: 0, length: 3 }).pipe(Effect.flip))._tag).toBe(
        "FileSystemError",
      )
      expect((yield* executor.stat("secret.txt")).sizeBytes).toBe(6)
    }),
  )

it.live("keeps every byte of a binary file, and names with unicode, spaces and a new line", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const all = Uint8Array.from({ length: 256 }, (_, index) => index)
    const names = ["naïve 文件 😀.bin", "with space.bin", "line\nbreak.bin"]
    yield* Effect.forEach(names, (name) => executor.write(`g6/${name}`, all), { discard: true })
    expect((yield* executor.list("g6")).map((entry) => entry.name).toSorted()).toEqual(names.toSorted())
    expect(
      yield* Effect.forEach(names, (name) => Effect.map(executor.read(`g6/${name}`), (read) => read.bytes)),
    ).toEqual(names.map(() => all))
    yield* executor.move("g6/line\nbreak.bin", "g6/moved\nname.bin")
    expect((yield* executor.read("g6/moved\nname.bin")).bytes).toEqual(all)
    yield* executor.remove("g6/moved\nname.bin")
    expect((yield* executor.stat("g6/moved\nname.bin").pipe(Effect.flip))._tag).toBe("FileNotFoundError")
  }),
)

it.live(
  "follows a chain of links on read, does not on stat, and gives typed errors for a link loop and a dangling link",
  () =>
    Effect.gen(function* () {
      const executor = yield* Executor.Service
      yield* executor.write("g7/target.txt", encoder.encode("target"))
      yield* Effect.promise(async () => {
        await symlink("target.txt", join(workspace, "g7/one"))
        await symlink("one", join(workspace, "g7/two"))
        await symlink("loop-b", join(workspace, "g7/loop-a"))
        await symlink("loop-a", join(workspace, "g7/loop-b"))
        await symlink("nowhere", join(workspace, "g7/dangling"))
      })
      expect(decoder.decode((yield* executor.read("g7/two")).bytes)).toBe("target")
      expect((yield* executor.stat("g7/two")).type).toBe("symlink")
      const loop = yield* executor.read("g7/loop-a").pipe(Effect.flip)
      expect(loop._tag === "FileSystemError" && loop.message).toContain("ELOOP")
      expect((yield* executor.stat("g7/loop-a")).type).toBe("symlink")
      expect((yield* executor.read("g7/dangling").pipe(Effect.flip))._tag).toBe("FileNotFoundError")
      expect((yield* executor.stat("g7/dangling")).type).toBe("symlink")
    }),
)

it.live("reaches paths outside the workspace by absolute path and by '..'", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const outside = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "ren-outside-")))
    yield* Effect.gen(function* () {
      yield* executor.write(join(outside, "absolute.txt"), encoder.encode("absolute"))
      expect(decoder.decode((yield* executor.read(relative(workspace, join(outside, "absolute.txt")))).bytes)).toBe(
        "absolute",
      )
      yield* executor.write(relative(workspace, join(outside, "relative.txt")), encoder.encode("relative"))
      expect(decoder.decode((yield* executor.read(join(outside, "relative.txt"))).bytes)).toBe("relative")
      expect((yield* executor.list(join(workspace, ".."))).length).toBeGreaterThan(0)
    }).pipe(Effect.ensuring(Effect.promise(() => rm(outside, { recursive: true, force: true }))))
  }),
)

it.live(
  "lists a folder with 100 000 items in one reply well under the file size limit",
  () =>
    Effect.gen(function* () {
      const executor = yield* Executor.Service
      yield* executor.mkdir("g9")
      const filled = yield* run({
        command: "sh",
        arguments: ["-c", "seq 1 100000 | sed 's/^/file-/' | xargs touch"],
        directory: "g9",
      })
      expect((yield* collect(filled.events)).exit).toEqual({ type: "exit", exitCode: 0, signal: null })
      const files = Processes.openFiles()
      const listed = yield* executor.list("g9")
      expect(listed).toHaveLength(100_000)
      expect(JSON.stringify(listed).length).toBeLessThan(EnvironmentApi.maxFileBytes)
      expect(Processes.openFiles()).toBe(files)
    }),
  60_000,
)

if (process.platform === "linux" ? existsSync("/dev/shm") : process.platform === "darwin")
  it.live("moves a file to another file system, or fails with a typed error and loses nothing", () =>
    Effect.gen(function* () {
      const executor = yield* Executor.Service
      const volume = yield* Effect.acquireRelease(
        Effect.promise(async () => {
          if (process.platform === "linux") return mkdtemp("/dev/shm/ren-")
          const name = `ren-${crypto.randomUUID().slice(0, 8)}`
          const image = join(await mkdtemp(join(tmpdir(), "ren-image-")), "volume.dmg")
          Bun.spawnSync(["hdiutil", "create", "-size", "4m", "-fs", "HFS+", "-volname", name, "-attach", image])
          return `/Volumes/${name}`
        }),
        (directory) =>
          Effect.sync(() => {
            if (process.platform === "linux") return void Bun.spawnSync(["rm", "-rf", directory])
            Bun.spawnSync(["hdiutil", "detach", directory, "-force"])
          }),
      )
      expect((yield* Effect.promise(() => stat(volume))).dev).not.toBe(
        (yield* Effect.promise(() => stat(workspace))).dev,
      )
      yield* executor.write("g10/file.txt", encoder.encode("across"))
      const moved = yield* executor.move("g10/file.txt", join(volume, "file.txt")).pipe(Effect.exit)
      if (Exit.isSuccess(moved)) {
        expect(decoder.decode((yield* executor.read(join(volume, "file.txt"))).bytes)).toBe("across")
        expect((yield* executor.stat("g10/file.txt").pipe(Effect.flip))._tag).toBe("FileNotFoundError")
      } else {
        const failure = Exit.isFailure(moved)
          ? moved.cause.reasons.flatMap((reason) => (reason._tag === "Fail" ? [reason.error] : []))
          : []
        expect(failure.map((error) => error._tag)).toEqual(["FileSystemError"])
        expect(decoder.decode((yield* executor.read("g10/file.txt")).bytes)).toBe("across")
        expect((yield* executor.stat(join(volume, "file.txt")).pipe(Effect.flip))._tag).toBe("FileNotFoundError")
      }
    }),
  )

it.live("removes a full folder without following the links in it, and a missing path, as rm -rf does", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    yield* executor.write("g11/outside.txt", encoder.encode("keep"))
    yield* executor.write("g11/full/deep/inner.txt", encoder.encode("gone"))
    yield* Effect.promise(() => symlink(join(workspace, "g11/outside.txt"), join(workspace, "g11/full/link")))
    yield* executor.remove("g11/full")
    expect((yield* executor.stat("g11/full").pipe(Effect.flip))._tag).toBe("FileNotFoundError")
    expect(decoder.decode((yield* executor.read("g11/outside.txt")).bytes)).toBe("keep")
    yield* executor.remove("g11/never-existed")
    const local = Bun.spawnSync(["rm", "-rf", join(workspace, "g11/never-existed")])
    expect(local.exitCode).toBe(0)
  }),
)

it.live("reads an empty range after the end of a file and a range of 0 bytes", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    yield* executor.write("g14.txt", encoder.encode("hello"))
    expect((yield* executor.read("g14.txt", { offset: 5, length: 10 })).bytes).toEqual(new Uint8Array())
    expect((yield* executor.read("g14.txt", { offset: 1_000, length: 10 })).bytes).toEqual(new Uint8Array())
    expect((yield* executor.read("g14.txt", { offset: 1, length: 0 })).bytes).toEqual(new Uint8Array())
    expect((yield* executor.read("g14.txt", { offset: 1_000, length: 10 })).info.sizeBytes).toBe(5)
  }),
)

it.live(
  "reads one whole version of a file that another process replaces at the same time",
  () =>
    Effect.gen(function* () {
      const executor = yield* Executor.Service
      yield* executor.mkdir("g16")
      const versions = [97, 98].map((byte, index) => new Uint8Array((index + 1) * mebibyte).fill(byte))
      yield* Effect.promise(() => writeFile(join(workspace, "g16/live.bin"), versions[0] ?? new Uint8Array()))
      let replacing = true
      const replacer = Effect.promise(async () => {
        for (let count = 0; replacing; count++) {
          await writeFile(join(workspace, "g16/next.bin"), versions[count % 2] ?? new Uint8Array())
          await rename(join(workspace, "g16/next.bin"), join(workspace, "g16/live.bin"))
        }
      })
      const replacing_ = yield* Effect.forkScoped(replacer)
      const reads = yield* Effect.forEach(
        Array.from({ length: 300 }),
        () => Effect.map(executor.read("g16/live.bin"), (read) => ({ size: read.info.sizeBytes, bytes: read.bytes })),
        { concurrency: 4 },
      )
      replacing = false
      yield* Fiber.join(replacing_)
      expect(
        reads.map((read) => ({
          uniform: read.bytes.every((byte) => byte === read.bytes[0]),
          whole: read.size === read.bytes.length,
        })),
      ).toEqual(reads.map(() => ({ uniform: true, whole: true })))
    }),
  60_000,
)
