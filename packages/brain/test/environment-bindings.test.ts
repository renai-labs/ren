import { expect, test } from "bun:test"
import { BunHttpServer, BunServices } from "@effect/platform-bun"
import { EnvironmentToken } from "@ren/brain-api/environment-token"
import { Signature } from "@ren/brain-api/signature"
import { NodeCompatible } from "@ren/executor/node-compatible"
import { Server } from "@ren/executor/server"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { ConfigProvider, Context, DateTime, Effect, Exit, Layer, Option, Schedule, Schema, Scope, Stream } from "effect"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http"
import { ChildProcess } from "effect/process"
import { KeyValueStore } from "effect/persistence"
import { mkdir, mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EnvironmentAccess } from "../src/environment-access.js"
import { EnvironmentBindings } from "../src/environment-bindings.js"
import { Environments } from "../src/environments.js"
import { OpenCodeWorkspaceDriver } from "../src/opencode-workspace-driver.js"
import { testEffect } from "./lib/effect.js"

const pair = await Effect.runPromise(Signature.generate("test"))
const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-bindings-")))
await mkdir(join(workspace, "project"))
await Bun.write(join(workspace, "project/notes.md"), "on the environment\n")
const executor = () =>
  HttpRouter.serve(Server.layer, { disableLogger: true }).pipe(
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
const it = testEffect(executor())

const build = Effect.fnUntraced(function* (store: Layer.Layer<KeyValueStore.KeyValueStore>) {
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
  const context = yield* Layer.build(
    EnvironmentBindings.layer.pipe(
      Layer.provideMerge(Environments.layer),
      Layer.provide(EnvironmentAccess.layerFixed([access])),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(store),
    ),
  )
  return {
    environments: Context.get(context, Environments.Service),
    bindings: Context.get(context, EnvironmentBindings.Service),
  }
})

const project = join(workspace, "project")

it.live("stores a binding and reads it back from the store in a new layer", () =>
  Effect.gen(function* () {
    const store = Layer.succeedContext(yield* Layer.build(KeyValueStore.layerMemory))
    const sessionId = Session.ID.create()
    const binding = { sessionDirectory: "/workspace", location: { environmentId, directory: project } }
    yield* (yield* build(store)).bindings.set(sessionId, binding)
    expect(yield* (yield* build(store)).bindings.get(sessionId)).toEqual(Option.some(binding))
    expect(yield* (yield* build(store)).bindings.get(Session.ID.create())).toEqual(Option.none())
  }),
)

it.live("refuses a directory the environment lacks, or a file, and keeps the old binding", () =>
  Effect.gen(function* () {
    const subject = yield* build(KeyValueStore.layerMemory)
    const sessionId = Session.ID.create()
    const binding = { sessionDirectory: "/workspace", location: { environmentId, directory: project } }
    yield* subject.bindings.set(sessionId, binding)
    const missing = yield* Effect.flip(
      subject.bindings.set(sessionId, { ...binding, location: { environmentId, directory: join(workspace, "gone") } }),
    )
    expect(missing.message).toContain("does not exist")
    const file = yield* Effect.flip(
      subject.bindings.set(sessionId, {
        ...binding,
        location: { environmentId, directory: join(project, "notes.md") },
      }),
    )
    expect(file.message).toContain("is not a directory")
    const unknown = yield* Effect.flip(
      subject.bindings.set(sessionId, {
        ...binding,
        location: { environmentId: Environment.ID.create(), directory: project },
      }),
    )
    expect(unknown._tag).toBe("EnvironmentBindings.Unusable")
    expect(yield* subject.bindings.get(sessionId)).toEqual(Option.some(binding))
  }),
)

it.live("follows the session's binding on every file call, under the session's directory", () =>
  Effect.gen(function* () {
    const subject = yield* build(KeyValueStore.layerMemory)
    const sessionId = Session.ID.create()
    const connection = OpenCodeWorkspaceDriver.sessionConnection(subject.environments, subject.bindings, sessionId)
    const unbound = yield* Effect.flip(connection.overrides.read("/workspace/notes.md"))
    expect(unbound._tag).toBe("Environment.Failed")
    yield* subject.bindings.set(sessionId, { sessionDirectory: "/workspace", location: null })
    expect((yield* Effect.flip(connection.overrides.read("/workspace/notes.md")))._tag).toBe("Environment.Failed")
    yield* subject.bindings.set(sessionId, {
      sessionDirectory: "/workspace",
      location: { environmentId, directory: project },
    })
    const read = yield* connection.overrides.read("/workspace/notes.md")
    expect(new TextDecoder().decode(read.bytes)).toBe("on the environment\n")
    const missing = yield* Effect.flip(connection.overrides.read("/workspace/absent.md"))
    expect(missing._tag === "Environment.NotFound" && missing.path).toBe("/workspace/absent.md")
  }),
)

test("maps paths under the session's directory onto the environment's directory", () => {
  const physical = OpenCodeWorkspaceDriver.physicalPath("/workspace", "/home/ren/project")
  expect(physical("/workspace")).toBe("/home/ren/project")
  expect(physical("/workspace/src/a.ts")).toBe("/home/ren/project/src/a.ts")
  expect(physical("/workspaces/other")).toBe("/workspaces/other")
  expect(physical("/tmp/out")).toBe("/tmp/out")
  expect(physical("relative/a.ts")).toBe("relative/a.ts")
})

const replaceable = Effect.gen(function* () {
  const server = yield* HttpServer.HttpServer
  const brain = Brain.ID.create()
  const expiresAt = DateTime.makeUnsafe(Date.now() + 600_000)
  const access = {
    environmentId,
    url: HttpServer.formatAddress(server.address),
    token: yield* EnvironmentToken.sign(pair.privateKey, {
      env: environmentId,
      brain,
      exp: Math.floor(DateTime.toEpochMillis(expiresAt) / 1000),
    }),
    expiresAt,
    generation: 1,
  }
  const context = yield* Layer.build(
    EnvironmentBindings.layer.pipe(
      Layer.provideMerge(Environments.layer),
      Layer.provideMerge(EnvironmentAccess.layerMemory([access])),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(KeyValueStore.layerMemory),
    ),
  )
  const sessionId = Session.ID.create()
  const bindings = Context.get(context, EnvironmentBindings.Service)
  yield* bindings.set(sessionId, { sessionDirectory: "/workspace", location: { environmentId, directory: project } })
  const replacement = yield* Scope.make()
  const next = Context.get(yield* Layer.buildWithScope(Layer.fresh(executor()), replacement), HttpServer.HttpServer)
  return {
    connection: OpenCodeWorkspaceDriver.sessionConnection(
      Context.get(context, Environments.Service),
      bindings,
      sessionId,
    ),
    replace: Context.get(context, EnvironmentAccess.Memory).set({
      ...access,
      url: HttpServer.formatAddress(next.address),
      generation: 2,
    }),
    stopReplacement: Scope.close(replacement, Exit.void),
  }
})

const text = (stream: Stream.Stream<Uint8Array, unknown>) => Stream.decodeText(stream).pipe(Stream.mkString)

const isGone = (pid: number) =>
  Effect.sync(() => {
    try {
      process.kill(pid, 0)
      return false
    } catch {
      return true
    }
  }).pipe(Effect.repeat({ until: (gone) => gone, schedule: Schedule.spaced(50) }), Effect.timeout(5_000))

it.live(
  "a command started before a replacement finishes there and returns its result, and the next goes to the new machine",
  () =>
    Effect.gen(function* () {
      const subject = yield* replaceable
      const old = yield* subject.connection.spawner.spawn(
        ChildProcess.make("sh", ["-c", "sleep 0.5; echo old; exit 6"]),
      )
      yield* subject.replace
      yield* Effect.sleep(100)
      const next = yield* subject.connection.spawner.spawn(ChildProcess.make("sh", ["-c", "echo new"]))
      expect(yield* text(next.stdout)).toBe("new\n")
      expect(yield* text(old.stdout)).toBe("old\n")
      expect(Number(yield* old.exitCode)).toBe(6)
      yield* subject.stopReplacement
      const after = yield* subject.connection.spawner.spawn(ChildProcess.make("true", [])).pipe(Effect.flip)
      expect(after.reason._tag).toBe("Unknown")
    }),
)

it.live("stopping a command after a replacement still kills it on the old machine", () =>
  Effect.gen(function* () {
    const subject = yield* replaceable
    const scope = yield* Scope.make()
    const old = yield* subject.connection.spawner.spawn(ChildProcess.make("sleep", ["30"])).pipe(Scope.provide(scope))
    yield* subject.replace
    yield* Effect.sleep(100)
    yield* Scope.close(scope, Exit.void)
    expect(yield* isGone(old.pid)).toBe(true)
  }),
)

test("maps a session directory saved with a trailing slash, and the root directory", () => {
  const trailing = OpenCodeWorkspaceDriver.physicalPath("/workspace/", "/home/ren/project")
  expect(trailing("/workspace")).toBe("/home/ren/project")
  expect(trailing("/workspace/src/a.ts")).toBe("/home/ren/project/src/a.ts")
  const toTrailing = OpenCodeWorkspaceDriver.physicalPath("/workspace", "/home/ren/project/")
  expect(toTrailing("/workspace")).toBe("/home/ren/project")
  expect(toTrailing("/workspace/a.ts")).toBe("/home/ren/project/a.ts")
  const root = OpenCodeWorkspaceDriver.physicalPath("/", "/home/ren/project")
  expect(root("/")).toBe("/home/ren/project")
  expect(root("/a.ts")).toBe("/home/ren/project/a.ts")
  const toRoot = OpenCodeWorkspaceDriver.physicalPath("/workspace", "/")
  expect(toRoot("/workspace")).toBe("/")
  expect(toRoot("/workspace/a.ts")).toBe("/a.ts")
})
