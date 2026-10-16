import { expect, setDefaultTimeout } from "bun:test"
import { BunHttpServer, BunServices } from "@effect/platform-bun"
import { createEmbeddedRoutes } from "@opencode/server/routes"
import { Environments } from "@ren/brain/environments"
import { EnvironmentAccess } from "@ren/brain/environment-access"
import { OpenCodeWorkspaceDriver } from "@ren/brain/opencode-workspace-driver"
import { EnvironmentToken } from "@ren/brain-api/environment-token"
import { Signature } from "@ren/brain-api/signature"
import { NodeCompatible } from "@ren/executor/node-compatible"
import { Server } from "@ren/executor/server"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { ConfigProvider, Context, DateTime, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Env } from "../src/env.js"
import { OpenCodeHarness } from "../src/harness/opencode/harness.js"
import { Host } from "../src/harness/opencode/host.js"
import { testEffect } from "./lib/effect.js"
import { Shared } from "./lib/shared.js"

setDefaultTimeout(30_000)

const pair = await Effect.runPromise(Signature.generate("test"))
const environmentId = Environment.ID.create()
const workspace = await realpath(await mkdtemp(join(tmpdir(), "ren-environment-")))
const stub = Shared.stub()

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

const open = Effect.gen(function* () {
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
      OpenCodeWorkspaceDriver.replacements(environments),
    ).pipe(Layer.provide(HttpServer.layerServices)),
    endpoints,
    () => Effect.succeedNone,
    true,
  )
  return yield* OpenCodeHarness.make(host, endpoints)
})

const run = Effect.fnUntraced(function* (tool: { readonly name: string; readonly input: unknown }) {
  const harness = yield* open
  const sessionId = Session.ID.create()
  yield* harness.start({
    sessionId,
    harness: "opencode",
    instructions: {},
    interactive: false,
    environments: [{ environmentId, directory: workspace }],
  })
  const script = stub.script({ tool })
  yield* harness.send({
    sessionId,
    messageId: Session.MessageID.create(),
    prompt: { text: `${script.marker} use the tool` },
    delivery: "steer",
    sender: { userId: "user_1" },
  })
  const answered = yield* Effect.promise(() => script.called(2))
  return answered.body.messages
    .filter((message) => message.role === "tool")
    .map((message) => JSON.stringify(message.content))
    .join("\n")
})

it.live("runs the shell tool on the environment's executor, in the attached directory", () =>
  Effect.gen(function* () {
    const result = yield* run({ name: "shell", input: { command: "echo hello > hello.txt && ls && pwd" } })
    expect(result).toContain("hello.txt")
    expect(result).toContain(workspace)
    expect(yield* Effect.promise(() => Bun.file(join(workspace, "hello.txt")).text())).toBe("hello\n")
  }),
)

it.live("reads a file on the environment", () =>
  Effect.gen(function* () {
    const marker = crypto.randomUUID()
    yield* Effect.promise(() => Bun.write(join(workspace, "notes.md"), `remote ${marker}\n`))
    expect(yield* run({ name: "read", input: { path: "notes.md" } })).toContain(marker)
  }),
)

it.live("greps the environment with its own rg", () =>
  Effect.gen(function* () {
    const marker = `needle${crypto.randomUUID().slice(0, 8)}`
    yield* Effect.promise(() => Bun.write(join(workspace, "src/found.ts"), `export const ${marker} = 1\n`))
    const result = yield* run({ name: "grep", input: { pattern: marker } })
    expect(result).toContain("found.ts")
  }),
)
