import { expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import type { ProcessEvent, SpawnInput } from "@ren/brain-api/executor-api"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { ConfigProvider, Context, Deferred, Duration, Effect, Exit, Layer, Option, Scope, Stream } from "effect"
import { TestClock } from "effect/testing"
import { mkdtemp, realpath, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Executor } from "../src/executor.js"
import { NodeCompatible } from "../src/node-compatible.js"
import { testEffect } from "./lib/effect.js"
import { Processes } from "./lib/process.js"

const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-executor-")))
const executor = NodeCompatible.layer.pipe(
  Layer.provide(BunServices.layer),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({ EXECUTOR_ENVIRONMENT_ID: Environment.ID.create(), EXECUTOR_WORKSPACE: workspace }),
    ),
  ),
)
const it = testEffect(executor)
const brain = Brain.ID.create()
const decoder = new TextDecoder()
const encoder = new TextEncoder()

const run = Effect.fnUntraced(function* (input: SpawnInput) {
  const executor = yield* Executor.Service
  const spawned = yield* executor.spawn(brain, input)
  return { executor, id: spawned.id, events: yield* executor.output(brain, spawned.id) }
})

const collect = (events: Stream.Stream<ProcessEvent>) =>
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

it.live("runs a command through a shell", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "echo", arguments: ["$((1 + 2))"], shell: true })
    expect((yield* collect(process.events)).stdout).toBe("3\n")
  }),
)

it.live("writes stdin and closes it", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "cat", arguments: [], hasStdin: true })
    yield* process.executor.writeStdin(brain, process.id, new TextEncoder().encode("hello"), true)
    expect(yield* collect(process.events)).toEqual({
      stdout: "hello",
      stderr: "",
      exit: { type: "exit", exitCode: 0, signal: null },
    })
  }),
)

it.live("refuses stdin for a process started without it", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "true", arguments: [] })
    const error = yield* process.executor.writeStdin(brain, process.id, new Uint8Array([1]), true).pipe(Effect.flip)
    expect(error._tag).toBe("OperationFailedError")
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

it.live("forgets a brain's oldest exited process once 25 newer ones have exited", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const own = Brain.ID.create()
    const finish = Effect.fnUntraced(function* () {
      const spawned = yield* executor.spawn(own, { command: "true", arguments: [] })
      yield* Stream.runDrain(yield* executor.output(own, spawned.id))
      return spawned.id
    })
    const oldest = yield* finish()
    const newer = yield* Effect.forEach(Array.from({ length: 24 }), () => finish())
    yield* Stream.runDrain(yield* executor.output(own, oldest))
    yield* finish()
    expect((yield* executor.output(own, oldest).pipe(Effect.flip))._tag).toBe("ProcessNotFoundError")
    yield* Effect.forEach(newer, (id) => executor.output(own, id), { discard: true })
  }),
)

it.live("replays output from a cursor, and gives each chunk its offset", () =>
  Effect.gen(function* () {
    const executor = yield* Executor.Service
    const spawned = yield* executor.spawn(brain, {
      command: "sh",
      arguments: ["-c", "printf abc; sleep 0.3; printf def"],
    })
    const chunks = (events: ReadonlyArray<ProcessEvent>) =>
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
    yield* Effect.sleep(1_000)
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

it.live("streams megabytes of output whole", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "head", arguments: ["-c", "5000000", "/dev/zero"] })
    const size = yield* process.events.pipe(
      Stream.runFold(
        () => 0,
        (total, event) => total + (event.type === "stdout" ? event.bytes.length : 0),
      ),
    )
    expect(size).toBe(5_000_000)
  }),
)

it.live("takes a megabyte of stdin in writes larger than its buffer", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "wc", arguments: ["-c"], hasStdin: true })
    const chunk = new Uint8Array(64 * 1024)
    yield* Effect.forEach(
      Array.from({ length: 16 }, () => chunk),
      (bytes) => process.executor.writeStdin(brain, process.id, bytes, false),
      { discard: true },
    )
    yield* process.executor.writeStdin(brain, process.id, new Uint8Array(), true)
    expect((yield* collect(process.events)).stdout.trim()).toBe(String(16 * 64 * 1024))
  }),
)

it.live("refuses stdin after it was closed", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "sh", arguments: ["-c", "cat; sleep 0.5"], hasStdin: true })
    yield* process.executor.writeStdin(brain, process.id, encoder.encode("a"), true)
    const error = yield* process.executor.writeStdin(brain, process.id, encoder.encode("b"), false).pipe(Effect.flip)
    expect(error._tag).toBe("OperationFailedError")
    expect((yield* collect(process.events)).stdout).toBe("a")
  }),
)

it.live("accepts a kill for a process that exited before anyone read its exit", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "true", arguments: [] })
    yield* Effect.sleep(300)
    yield* process.executor.kill(brain, process.id, "SIGTERM")
    expect((yield* collect(process.events)).exit).toEqual({ type: "exit", exitCode: 0, signal: null })
  }),
)

it.live("runs a command through the named shell", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: 'echo "${BASH_VERSION:+bash}"', arguments: [], shell: "/bin/bash" })
    expect((yield* collect(process.events)).stdout).toBe("bash\n")
  }),
)

it.live("reports a signal the process sent itself", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "sh", arguments: ["-c", "kill -KILL $$"] })
    expect((yield* collect(process.events)).exit).toEqual({ type: "exit", exitCode: null, signal: "SIGKILL" })
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
    expect(error._tag).toBe("OperationFailedError")
    const directory = yield* executor
      .spawn(brain, { command: "true", arguments: [], directory: "ren-no-such-directory" })
      .pipe(Effect.flip)
    expect(directory._tag).toBe("OperationFailedError")
  }),
)

it.effect("a reader that stops reading holds a command back for 15 seconds at most, then the command runs on", () =>
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
    yield* Effect.promise(() => Bun.sleep(500))
    expect(Processes.running(spawned.pid)).toBe(true)
    yield* TestClock.adjust(Duration.seconds(16))
    const finished = yield* Effect.promise(() => Bun.sleep(100)).pipe(
      Effect.map(() => !Processes.running(spawned.pid)),
      Effect.repeat({ until: (done) => done, times: 25 }),
    )
    expect(finished).toBe(true)
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
