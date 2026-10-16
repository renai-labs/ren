import { expect } from "bun:test"
import { BunServices } from "@effect/platform-bun"
import type { ProcessEvent, SpawnInput } from "@ren/brain-api/executor-api"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { ConfigProvider, Duration, Effect, Layer, Option, Stream } from "effect"
import { TestClock } from "effect/testing"
import { mkdtemp, realpath, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Executor } from "../src/executor.js"
import { NodeCompatible } from "../src/node-compatible.js"
import { testEffect } from "./lib/effect.js"
import { Processes } from "./lib/process.js"

const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-executor-")))
const it = testEffect(
  NodeCompatible.layer.pipe(
    Layer.provide(BunServices.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({ EXECUTOR_ENVIRONMENT_ID: Environment.ID.create(), EXECUTOR_WORKSPACE: workspace }),
      ),
    ),
  ),
)
const brain = Brain.ID.create()
const decoder = new TextDecoder()

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
    expect(first).toEqual([{ type: "stdout", bytes: new TextEncoder().encode("started\n") }])
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

it.live("forgets a process once its exit is read", () =>
  Effect.gen(function* () {
    const process = yield* run({ command: "true", arguments: [] })
    yield* Stream.runDrain(process.events)
    expect((yield* process.executor.output(brain, process.id).pipe(Effect.flip))._tag).toBe("ProcessNotFoundError")
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
