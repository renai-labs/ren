import { expect, test } from "bun:test"
import { BunHttpServer, BunServices } from "@effect/platform-bun"
import { EnvironmentToken } from "@ren/brain-api/environment-token"
import { Signature } from "@ren/brain-api/signature"
import { NodeCompatible } from "@ren/executor/node-compatible"
import { Server } from "@ren/executor/server"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { ConfigProvider, Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http"
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
const it = testEffect(
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
  ),
)

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
