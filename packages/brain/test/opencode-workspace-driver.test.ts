import { expect } from "bun:test"
import { EnvironmentFiles } from "@opencode/core/environment/files"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { Machine, Processes, Relay, testEffect } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Context, Effect, Layer, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { ChildProcess } from "effect/process"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Environments } from "../src/environments.js"
import { EnvironmentAccess } from "../src/environment-access.js"
import { OpenCodeWorkspaceDriver } from "../src/opencode-workspace-driver.js"

const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "opencode-workspace-driver-")))
const it = testEffect(Machine.layer({ environmentId, workspace }))

const connectTo = Effect.fnUntraced(function* (url: string) {
  const access = yield* Machine.access({ url, environmentId, brain: Brain.ID.create() })
  const environments = yield* Layer.build(
    Environments.layer.pipe(
      Layer.provide(EnvironmentAccess.layerFixed([access])),
      Layer.provide(FetchHttpClient.layer),
    ),
  ).pipe(Effect.map((context) => Context.get(context, Environments.Service)))
  return yield* environments.connect(environmentId)
})

const connect = Effect.flatMap(Machine.url, connectTo)

const throughRelay = Effect.gen(function* () {
  const relay = yield* Relay.make(Relay.portOf(yield* Machine.url))
  return { relay, spawner: OpenCodeWorkspaceDriver.spawner(yield* connectTo(relay.url)) }
})

const text = (stream: Stream.Stream<Uint8Array, unknown>) => Stream.decodeText(stream).pipe(Stream.mkString)

const firstLine = (stream: Stream.Stream<Uint8Array, unknown>) =>
  Stream.decodeText(stream).pipe(Stream.take(1), Stream.mkString)

it.live("runs a command and gives its output and exit code", () =>
  Effect.gen(function* () {
    const spawner = OpenCodeWorkspaceDriver.spawner(yield* connect)
    const handle = yield* spawner.spawn(ChildProcess.make("sh", ["-c", "echo out; echo err >&2; exit 3"]))
    expect(yield* text(handle.stdout)).toBe("out\n")
    expect(yield* text(handle.stderr)).toBe("err\n")
    expect(Number(yield* handle.exitCode)).toBe(3)
  }),
)

it.live("feeds a stdin stream and closes it when the stream ends", () =>
  Effect.gen(function* () {
    const spawner = OpenCodeWorkspaceDriver.spawner(yield* connect)
    const handle = yield* spawner.spawn(
      ChildProcess.make("cat", [], {
        stdin: Stream.make(new TextEncoder().encode("one "), new TextEncoder().encode("two")),
      }),
    )
    expect(yield* text(handle.stdout)).toBe("one two")
    expect(Number(yield* handle.exitCode)).toBe(0)
  }),
)

it.live("fails the exit code with KilledBySignal, as OpenCode's shell expects", () =>
  Effect.gen(function* () {
    const spawner = OpenCodeWorkspaceDriver.spawner(yield* connect)
    const handle = yield* spawner.spawn(ChildProcess.make("sleep", ["30"]))
    yield* handle.kill({ killSignal: "SIGTERM" })
    const error = yield* handle.exitCode.pipe(Effect.flip)
    expect(error.cause).toBeInstanceOf(CrossSpawnSpawner.KilledBySignal)
    expect(error.cause instanceof CrossSpawnSpawner.KilledBySignal && error.cause.signal).toBe("SIGTERM")
  }),
)

it.live("maps file operations and their errors to OpenCode's", () =>
  Effect.gen(function* () {
    const files = OpenCodeWorkspaceDriver.files(yield* connect)
    yield* files.mkdir("tree/a")
    yield* files.write("tree/a/file.txt", new TextEncoder().encode("hello world"))
    const read = yield* files.read("tree/a/file.txt", { offset: 6, length: 5 })
    expect(new TextDecoder().decode(read.bytes)).toBe("world")
    expect(read.info).toMatchObject({ type: "file", size: 11 })
    expect(yield* files.list("tree/a")).toEqual([{ name: "file.txt", type: "file" }])
    expect(yield* files.stat("missing").pipe(Effect.flip)).toBeInstanceOf(EnvironmentFiles.NotFound)
    const wrong = yield* files.read("tree").pipe(Effect.flip)
    expect(wrong instanceof EnvironmentFiles.WrongKind && wrong.actual).toBe("directory")
    yield* files.move("tree/a/file.txt", "tree/moved.txt")
    expect((yield* files.stat("tree/moved.txt")).size).toBe(11)
    expect(yield* files.move("tree/a/file.txt", "tree/again.txt").pipe(Effect.flip)).toBeInstanceOf(
      EnvironmentFiles.NotFound,
    )
    expect(yield* files.write("tree/moved.txt/child.txt", new Uint8Array()).pipe(Effect.flip)).toBeInstanceOf(
      EnvironmentFiles.Failed,
    )
    yield* files.remove("tree")
    expect(yield* files.stat("tree").pipe(Effect.flip)).toBeInstanceOf(EnvironmentFiles.NotFound)
  }),
)

it.live("ends stdin when a stream run into the stdin sink ends, as Effect's spawner does", () =>
  Effect.gen(function* () {
    const spawner = OpenCodeWorkspaceDriver.spawner(yield* connect)
    const handle = yield* spawner.spawn(ChildProcess.make("cat", []))
    yield* Stream.make(new TextEncoder().encode("sink")).pipe(Stream.run(handle.stdin))
    expect(Number(yield* handle.exitCode.pipe(Effect.timeout(2_000)))).toBe(0)
    expect(yield* text(handle.stdout)).toBe("sink")
  }),
)

it.live("loses no output and keeps the exit code when the connection drops mid-command", () =>
  Effect.gen(function* () {
    const through = yield* throughRelay
    const handle = yield* through.spawner.spawn(
      ChildProcess.make("sh", ["-c", "echo one; sleep 0.5; echo two; sleep 0.5; echo three; exit 7"]),
    )
    const first = yield* firstLine(handle.stdout)
    yield* through.relay.cut
    expect(first + (yield* text(handle.stdout))).toBe("one\ntwo\nthree\n")
    expect(yield* text(handle.stderr)).toBe("")
    expect(Number(yield* handle.exitCode)).toBe(7)
  }),
)

it.live("says the environment lost the command when a restarted executor no longer knows it", () =>
  Effect.gen(function* () {
    const through = yield* throughRelay
    const restarted = yield* Layer.build(Layer.fresh(Machine.layer({ environmentId, workspace }))).pipe(
      Effect.flatMap((context) => Effect.provide(Machine.url, context)),
    )
    const handle = yield* through.spawner.spawn(ChildProcess.make("sh", ["-c", "echo started; sleep 30"]))
    yield* firstLine(handle.stdout)
    yield* through.relay.target(Relay.portOf(restarted))
    yield* through.relay.cut
    yield* handle.exitCode.pipe(Effect.flip, Effect.timeout(10_000))
    expect(yield* text(handle.stderr)).toContain("[environment disconnected: the command did not finish]")
  }),
)

it.live("notes how much output was lost when the executor no longer has it", () =>
  Effect.gen(function* () {
    const through = yield* throughRelay
    const handle = yield* through.spawner.spawn(
      ChildProcess.make("sh", ["-c", "echo start; sleep 0.5; head -c 3000000 /dev/zero; echo; echo end"]),
    )
    yield* firstLine(handle.stdout)
    yield* through.relay.refuse(true)
    yield* through.relay.cut
    expect(yield* Processes.exits(handle.pid)).toBe(true)
    yield* through.relay.refuse(false)
    const stdout = yield* text(handle.stdout)
    expect(stdout.endsWith("\nend\n")).toBe(true)
    expect(yield* text(handle.stderr)).toMatch(/\[environment reconnected: \d+ bytes of output were lost\]/)
    expect(Number(yield* handle.exitCode)).toBe(0)
  }),
)

it.live("keeps the output and exit code of two commands running at once apart", () =>
  Effect.gen(function* () {
    const spawner = OpenCodeWorkspaceDriver.spawner(yield* connect)
    const run = (name: string, code: number) =>
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(
          ChildProcess.make("sh", [
            "-c",
            `for i in 1 2 3; do echo ${name}$i; echo ${name}-err$i >&2; sleep 0.1; done; exit ${code}`,
          ]),
        )
        const [stdout, stderr, exit] = yield* Effect.all([text(handle.stdout), text(handle.stderr), handle.exitCode], {
          concurrency: "unbounded",
        })
        return { stdout, stderr, exit: Number(exit) }
      })
    const [left, right] = yield* Effect.all([run("left", 3), run("right", 4)], { concurrency: "unbounded" })
    expect(left).toEqual({ stdout: "left1\nleft2\nleft3\n", stderr: "left-err1\nleft-err2\nleft-err3\n", exit: 3 })
    expect(right).toEqual({
      stdout: "right1\nright2\nright3\n",
      stderr: "right-err1\nright-err2\nright-err3\n",
      exit: 4,
    })
  }),
)

it.live("runs a shell script in a shell the machine has, and leaves other commands alone", () =>
  Effect.gen(function* () {
    const spawner = OpenCodeWorkspaceDriver.spawner(yield* connect)
    const lacking = yield* spawner.spawn(ChildProcess.make("/no/such/dir/ksh", ["-c", "echo $((6 * 7))"]))
    expect(yield* text(lacking.stdout)).toBe("42\n")
    expect(Number(yield* lacking.exitCode)).toBe(0)
    const present = yield* spawner.spawn(ChildProcess.make("/bin/sh", ["-c", 'echo "${ZSH_VERSION:-not zsh}"']))
    expect(yield* text(present.stdout)).toBe("not zsh\n")
    const notScript = yield* spawner.spawn(ChildProcess.make("/no/such/dir/ksh", ["--version"])).pipe(Effect.flip)
    expect(notScript.reason._tag).toBe("Unknown")
  }),
)
