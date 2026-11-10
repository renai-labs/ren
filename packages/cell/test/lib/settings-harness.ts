export * as SettingsHarness from "./settings-harness.js"

import { OpenCode, Session } from "@opencode/client/effect"
import { createEmbeddedRoutes } from "@opencode/server/routes"
// ast-grep-ignore: no-import-alias -- OpenCode's Session is imported too, and both are values
import { Session as RenSession } from "@ren/schema/session"
import type { SessionSettings } from "@ren/schema/session/settings"
import type { Models } from "@ren/schema/models"
import { Context, Effect, Layer, Option, Schema, Struct } from "effect"
import { FetchHttpClient, HttpServer } from "effect/http"
import { mkdir, mkdtemp, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ChatSettings } from "../../src/chat-settings.js"
import { Env } from "../../src/env.js"
import { ModelCatalog } from "../../src/model-catalog.js"
import type { Harness } from "../../src/harness/harness.js"
import type { HarnessConfig } from "../../src/harness/config.js"
import { OpenCodeHarness } from "../../src/harness/opencode/harness.js"
import { OpenCodeServer } from "../../src/harness/opencode/server.js"
import { ModelsTest } from "./models.js"
import { Shared } from "./shared.js"
import type { StubModel } from "./stub-model.js"

const stub = Shared.stub()

export const open = Effect.fnUntraced(function* (
  initial: SessionSettings.Layers,
  options: {
    readonly database?: string
    readonly sessionId?: RenSession.ID
    readonly interactive?: boolean
    readonly start?: boolean
    readonly stored?: Map<string, string>
    readonly directory?: string
    readonly refreshKey?: Harness.Refresh
    readonly config?: string
    readonly catalog?: ModelCatalog.Interface
    readonly restore?: boolean
    readonly models?: ReadonlyArray<Models.Endpoint>
  } = {},
) {
  const refreshKey = options.refreshKey ?? (() => Effect.succeedNone)
  const access = Struct.evolve(Shared.access(undefined, stub.url), {
    endpoints: (endpoints) =>
      options.models ??
      endpoints.map((endpoint) =>
        Struct.evolve(endpoint, {
          models: (models) => models.map((model) => Struct.assign(model, { variants: [{ id: "high" }] })),
        }),
      ),
  })
  const directory =
    options.directory ?? (yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "ren-settings-")))))
  const settings = Context.get(
    yield* Layer.build(ChatSettings.layer.pipe(Layer.provide(ModelsTest.storage(options.stored)))),
    ChatSettings.Service,
  )
  if (!options.restore) yield* settings.save(initial, [])
  const cached = options.catalog ? yield* options.catalog.current : Option.none()
  const endpoints = Option.isSome(cached)
    ? [...access.endpoints, ...(yield* ModelCatalog.endpoints(cached.value, refreshKey))]
    : access.endpoints
  const server = yield* OpenCodeServer.make(
    (replacements) =>
      createEmbeddedRoutes(
        {
          database: { path: options.database ?? ":memory:" },
          config: {
            directory,
            project: false,
            content: options.config ?? Schema.decodeUnknownSync(Env.Vars)(Shared.vars(stub.url)).OPENCODE_CONFIG,
          },
          models: { fetch: false },
          fs: { filewatcher: false, fff: false },
        },
        replacements,
      ).pipe(Layer.provide(HttpServer.layerServices)),
    endpoints,
    refreshKey,
    Option.none(),
    {
      saved: Option.some(settings.saved),
      directoryOf: (sessionId) => join(directory, sessionId),
      makeDirectory: (path) => Effect.promise(() => mkdir(path, { recursive: true })),
    },
  )
  const harness = yield* OpenCodeHarness.make(
    server,
    endpoints,
    Option.some(settings),
    Option.map(Option.fromUndefinedOr(options.catalog), (catalog) => ({ catalog, refreshKey })),
  )
  const client = yield* OpenCode.make({ baseUrl: "http://opencode" }).pipe(
    Effect.provide(Layer.fresh(FetchHttpClient.layer)),
    Effect.provideService(
      FetchHttpClient.Fetch,
      Object.assign(
        (input: string | URL | Request, init?: RequestInit) =>
          server.fetch(new Request(input instanceof Request ? input.url : String(input), init)),
        { preconnect: fetch.preconnect },
      ),
    ),
  )
  const sessionId = options.sessionId ?? RenSession.ID.create()
  const sessionID = Session.ID.make(sessionId)
  if (options.start !== false)
    yield* harness.start({ sessionId, harness: "opencode", interactive: options.interactive ?? true })
  const turn = (script: StubModel.Script) =>
    harness
      .send({
        sessionId,
        messageId: RenSession.MessageID.create(),
        prompt: { text: `${script.marker} go` },
        delivery: "steer",
        sender: { userId: "user_1" },
      })
      .pipe(Effect.andThen(client.experimental.session.wait({ sessionID })), Effect.orDie)
  const pull = (layers: SessionSettings.Layers, update: Omit<HarnessConfig.Update, "settings"> = {}) =>
    Effect.gen(function* () {
      yield* settings.save(layers, [{ id: sessionId, agent: null, archived: false }])
      yield* harness.configure({
        ...update,
        settings: { layers: yield* settings.layers, chats: [{ id: sessionId, agent: null, archived: false }] },
      })
      yield* Shared.appsSettled(harness)
    })
  return { server, harness, client, sessionId, sessionID, turn, pull, directory, access }
})
