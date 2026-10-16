import { expect } from "bun:test"
import { BunHttpServer, BunServices } from "@effect/platform-bun"
import { EnvironmentFiles } from "@opencode/core/environment/files"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { EnvironmentToken } from "@ren/brain-api/environment-token"
import { Signature } from "@ren/brain-api/signature"
import { NodeCompatible } from "@ren/executor/node-compatible"
import { Server } from "@ren/executor/server"
import { Relay } from "@ren/executor/testing"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { ConfigProvider, Context, DateTime, Effect, Exit, Layer, Schema, Scope, Stream } from "effect"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http"
import { ChildProcess } from "effect/process"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Environments } from "../src/environments.js"
import { EnvironmentAccess } from "../src/environment-access.js"
import { OpenCodeWorkspaceDriver } from "../src/opencode-workspace-driver.js"
import { testEffect } from "./lib/effect.js"

const pair = await Effect.runPromise(Signature.generate("test"))
const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "opencode-workspace-driver-")))
const executor = HttpRouter.serve(Server.layer, { disableLogger: true }).pipe(
  Layer.provide(HttpServer.layerServices),
  Layer.provide(NodeCompatible.layer),
  Layer.provide(BunServices.layer),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        EXECUTOR_ENVIRONMENT_ID: environmentId,
        EXECUTOR_WORKSPACE: workspace,
        BRAIN_PUBLIC_KEYS: Schema.encodeSync(Signature.PublicKeys)([pair.publicKey]),
      }),
    ),
  ),
  Layer.provideMerge(BunHttpServer.layer({ port: 0, hostname: "127.0.0.1" })),
)
const it = testEffect(executor)

const served = Effect.map(HttpServer.HttpServer, (server) => HttpServer.formatAddress(server.address))

const connectTo = Effect.fnUntraced(function* (url: string) {
  const expiresAt = DateTime.makeUnsafe(Date.now() + 600_000)
  const access = {
    environmentId,
    url,
    token: yield* EnvironmentToken.sign(pair.privateKey, {
      env: environmentId,
      brain: Brain.ID.create(),
      exp: Math.floor(DateTime.toEpochMillis(expiresAt) / 1000),
    }),
    expiresAt,
    generation: 1,
  }
  const environments = yield* Layer.build(
    Environments.layer.pipe(
      Layer.provide(EnvironmentAccess.layerFixed([access])),
      Layer.provide(FetchHttpClient.layer),
    ),
  ).pipe(Effect.map((context) => Context.get(context, Environments.Service)))
  return yield* environments.connect(environmentId)
})

const connect = Effect.flatMap(served, connectTo)

const throughRelay = Effect.gen(function* () {
  const relay = yield* Relay.make(Relay.portOf(yield* served))
  return { relay, spawner: OpenCodeWorkspaceDriver.spawner(yield* connectTo(relay.url)) }
})

const text = (stream: Stream.Stream<Uint8Array, unknown>) => Stream.decodeText(stream).pipe(Stream.mkString)

const firstLine = (stream: Stream.Stream<Uint8Array, unknown>) =>
  Stream.decodeText(stream).pipe(Stream.take(1), Stream.mkString)

const disconnected = "[environment disconnected: the command did not finish]"

it.live("runs a command and gives its output and exit code", () =>
  Effect.gen(function* () {
    const spawner = OpenCodeWorkspaceDriver.spawner(yield* connect)
    const handle = yield* spawner.spawn(ChildProcess.make("sh", ["-c", "echo out; echo err >&2; exit 3"]))
    expect(yield* text(handle.stdout)).toBe("out\n")
    expect(yield* text(handle.stderr)).toBe("err\n")
    expect(Number(yield* handle.exitCode)).toBe(3)
  }),
)

it.live("merges stdout and stderr in all", () =>
  Effect.gen(function* () {
    const spawner = OpenCodeWorkspaceDriver.spawner(yield* connect)
    const handle = yield* spawner.spawn(ChildProcess.make("sh", ["-c", "echo a; echo b >&2"], { cwd: workspace }))
    expect((yield* text(handle.all)).split("\n").toSorted()).toEqual(["", "a", "b"])
    expect(Number(yield* handle.exitCode)).toBe(0)
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

it.live("kills the process when its scope closes", () =>
  Effect.gen(function* () {
    const spawner = OpenCodeWorkspaceDriver.spawner(yield* connect)
    const scope = yield* Scope.make()
    const handle = yield* spawner.spawn(ChildProcess.make("sleep", ["30"])).pipe(Scope.provide(scope))
    yield* Scope.close(scope, Exit.void)
    yield* Effect.sleep(200)
    expect(() => process.kill(handle.pid, 0)).toThrow()
  }),
)

it.live("refuses a piped command", () =>
  Effect.gen(function* () {
    const spawner = OpenCodeWorkspaceDriver.spawner(yield* connect)
    const error = yield* spawner
      .spawn(ChildProcess.make("echo", ["a"]).pipe(ChildProcess.pipeTo(ChildProcess.make("cat", []))))
      .pipe(Effect.flip)
    expect(error.reason._tag).toBe("BadArgument")
  }),
)

it.live("maps file errors to OpenCode's", () =>
  Effect.gen(function* () {
    const files = OpenCodeWorkspaceDriver.files(yield* connect)
    yield* files.write("dir/a.txt", new TextEncoder().encode("hello"))
    expect(new TextDecoder().decode((yield* files.read("dir/a.txt")).bytes)).toBe("hello")
    expect(yield* files.list("dir")).toEqual([{ name: "a.txt", type: "file" }])
    expect(yield* files.stat("missing").pipe(Effect.flip)).toBeInstanceOf(EnvironmentFiles.NotFound)
    const wrong = yield* files.read("dir").pipe(Effect.flip)
    expect(wrong).toBeInstanceOf(EnvironmentFiles.WrongKind)
    expect(wrong instanceof EnvironmentFiles.WrongKind && wrong.actual).toBe("directory")
  }),
)

it.live("reports whether the process is running", () =>
  Effect.gen(function* () {
    const spawner = OpenCodeWorkspaceDriver.spawner(yield* connect)
    const handle = yield* spawner.spawn(ChildProcess.make("sh", ["-c", "sleep 0.3"]))
    expect(yield* handle.isRunning).toBe(true)
    yield* handle.exitCode
    expect(yield* handle.isRunning).toBe(false)
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

it.live("keeps stdin open after the stream ends when endOnDone is false", () =>
  Effect.gen(function* () {
    const spawner = OpenCodeWorkspaceDriver.spawner(yield* connect)
    const handle = yield* spawner.spawn(
      ChildProcess.make("cat", [], { stdin: { stream: Stream.make(new TextEncoder().encode("open")), endOnDone: false } }),
    )
    yield* Effect.sleep(300)
    expect(yield* handle.isRunning).toBe(true)
    yield* handle.kill({ killSignal: "SIGKILL" })
  }),
)

it.live("forces a kill after the delay when the process ignores the signal", () =>
  Effect.gen(function* () {
    const spawner = OpenCodeWorkspaceDriver.spawner(yield* connect)
    const handle = yield* spawner.spawn(ChildProcess.make("sh", ["-c", "trap '' TERM; echo ready; sleep 30 & wait"]))
    yield* handle.stdout.pipe(Stream.take(1), Stream.runDrain)
    yield* handle.kill({ killSignal: "SIGTERM", forceKillAfter: "200 millis" })
    const error = yield* handle.exitCode.pipe(Effect.flip)
    expect(error.cause instanceof CrossSpawnSpawner.KilledBySignal && error.cause.signal).toBe("SIGKILL")
  }),
)

it.live("reads a range, makes directories, moves and removes files", () =>
  Effect.gen(function* () {
    const files = OpenCodeWorkspaceDriver.files(yield* connect)
    yield* files.mkdir("tree/a/b")
    yield* files.write("tree/a/b/file.txt", new TextEncoder().encode("hello world"))
    const read = yield* files.read("tree/a/b/file.txt", { offset: 6, length: 5 })
    expect(new TextDecoder().decode(read.bytes)).toBe("world")
    expect(read.info).toMatchObject({ type: "file", size: 11 })
    yield* files.move("tree/a/b/file.txt", "tree/moved.txt")
    expect((yield* files.stat("tree/moved.txt")).size).toBe(11)
    expect(yield* files.move("tree/a/b/file.txt", "tree/again.txt").pipe(Effect.flip)).toBeInstanceOf(
      EnvironmentFiles.NotFound,
    )
    yield* files.remove("tree")
    expect(yield* files.stat("tree").pipe(Effect.flip)).toBeInstanceOf(EnvironmentFiles.NotFound)
  }),
)

it.live("fails a write under a file with OpenCode's Failed", () =>
  Effect.gen(function* () {
    const files = OpenCodeWorkspaceDriver.files(yield* connect)
    yield* files.write("plain.txt", new TextEncoder().encode("plain"))
    expect(yield* files.write("plain.txt/child.txt", new Uint8Array()).pipe(Effect.flip)).toBeInstanceOf(
      EnvironmentFiles.Failed,
    )
  }),
)

it.live("fails an executor that refuses the token as unreachable, and does not keep the connection", () =>
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer
    const expiresAt = DateTime.makeUnsafe(Date.now() + 600_000)
    const stranger = yield* Signature.generate("stranger")
    const access = {
      environmentId,
      url: HttpServer.formatAddress(server.address),
      token: yield* EnvironmentToken.sign(stranger.privateKey, {
        env: environmentId,
        brain: Brain.ID.create(),
        exp: Math.floor(DateTime.toEpochMillis(expiresAt) / 1000),
      }),
      expiresAt,
      generation: 1,
    }
    const environments = yield* Layer.build(
      Environments.layer.pipe(
        Layer.provide(EnvironmentAccess.layerFixed([access])),
        Layer.provide(FetchHttpClient.layer),
      ),
    ).pipe(Effect.map((context) => Context.get(context, Environments.Service)))
    const errors = yield* Effect.forEach([1, 2], () => environments.connect(environmentId).pipe(Effect.flip))
    expect(errors.map((error) => error.reason)).toEqual(["unreachable", "unreachable"])
    expect(errors[0]?.message).toContain("Authentication required")
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

it.live(
  "reconnects when the output stream goes silent for three missed pings",
  () =>
    Effect.gen(function* () {
      const through = yield* throughRelay
      const handle = yield* through.spawner.spawn(ChildProcess.make("sh", ["-c", "echo before; sleep 1; echo after"]))
      const first = yield* firstLine(handle.stdout)
      yield* through.relay.freeze
      expect(first + (yield* text(handle.stdout))).toBe("before\nafter\n")
      expect(Number(yield* handle.exitCode)).toBe(0)
    }),
  40_000,
)

it.live("says the environment lost the command when a restarted executor no longer knows it", () =>
  Effect.gen(function* () {
    const through = yield* throughRelay
    const restarted = Context.get(yield* Layer.build(Layer.fresh(executor)), HttpServer.HttpServer)
    const handle = yield* through.spawner.spawn(ChildProcess.make("sh", ["-c", "echo started; sleep 30"]))
    yield* firstLine(handle.stdout)
    yield* through.relay.target(Relay.portOf(HttpServer.formatAddress(restarted.address)))
    yield* through.relay.cut
    yield* handle.exitCode.pipe(Effect.flip, Effect.timeout(10_000))
    expect(yield* text(handle.stderr)).toContain(disconnected)
  }),
)

it.live(
  "gives up, and says so, when the executor stays unreachable for 30 seconds",
  () =>
    Effect.gen(function* () {
      const through = yield* throughRelay
      const handle = yield* through.spawner.spawn(ChildProcess.make("sh", ["-c", "echo started; sleep 60"]))
      yield* firstLine(handle.stdout)
      yield* through.relay.refuse(true)
      yield* through.relay.cut
      const started = Date.now()
      yield* handle.exitCode.pipe(Effect.flip)
      expect(Date.now() - started).toBeGreaterThanOrEqual(25_000)
      expect(yield* text(handle.stderr)).toContain(disconnected)
    }),
  60_000,
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
    yield* Effect.sleep(2_500)
    yield* through.relay.refuse(false)
    const stdout = yield* text(handle.stdout)
    expect(stdout.endsWith("\nend\n")).toBe(true)
    expect(yield* text(handle.stderr)).toMatch(/\[environment reconnected: \d+ bytes of output were lost\]/)
    expect(Number(yield* handle.exitCode)).toBe(0)
  }),
)
