import { expect } from "bun:test"
import { BunHttpServer, BunServices } from "@effect/platform-bun"
import { EnvironmentFiles } from "@opencode/core/environment/files"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { EnvironmentToken } from "@ren/brain-api/environment-token"
import { Signature } from "@ren/brain-api/signature"
import { NodeCompatible } from "@ren/executor/node-compatible"
import { Server } from "@ren/executor/server"
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

const connect = Effect.gen(function* () {
  const server = yield* HttpServer.HttpServer
  const expiresAt = DateTime.makeUnsafe(Date.now() + 600_000)
  const access = {
    environmentId,
    url: HttpServer.formatAddress(server.address),
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

const text = (stream: Stream.Stream<Uint8Array, unknown>) => Stream.decodeText(stream).pipe(Stream.mkString)

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
