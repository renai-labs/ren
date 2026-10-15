import { afterAll, beforeAll, describe, expect, setDefaultTimeout } from "bun:test"
import { ModelsApi } from "@ren/brain-api/models-api"
import { SessionToken } from "@ren/brain-api/session-token"
import { Celld, Shared, TestToken } from "@ren/cell/testing"
import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import { ConfigProvider, DateTime, Effect, Layer, ManagedRuntime, Option, Ref } from "effect"
import { FetchHttpClient, HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { BrainHost } from "../src/brain-host.js"
import { Models } from "../src/models.js"
import { testEffect } from "./lib/effect.js"

setDefaultTimeout(60_000)

const stub = Shared.stub()
const minuteMs = 60_000
const granted = Ref.makeUnsafe(0)

const models = Layer.succeed(
  Models.Service,
  Models.Service.of({
    catalog: () => Effect.succeed({ endpoints: [] }),
    grant: () =>
      Effect.gen(function* () {
        const count = yield* Ref.updateAndGet(granted, (value) => value + 1)
        const lifetimeMs = count === 1 ? 2 * minuteMs : 60 * minuteMs
        return Shared.access({ stub: Shared.apiKey(`sk-granted-${count}`, Date.now() + lifetimeMs) })
      }),
    refreshIfDue: () => Effect.succeedNone,
    revoke: () => Effect.void,
  }),
)

const settings = { CELL_URL: "", CELL_KEYS: TestToken.vars.CELL_KEYS }

const hostWith = (config: Record<string, string>) =>
  BrainHost.layer.pipe(
    Layer.provide(models),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))),
  )

const api = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(ModelsApi).pipe(
    Layer.provide(
      HttpApiBuilder.group(ModelsApi, "models", (handlers) =>
        Effect.gen(function* () {
          const brain = yield* BrainHost.Service
          return handlers.handle("models.refresh", (request) =>
            brain.refreshModels(request.headers.authorization.replace(/^Bearer /u, "")),
          )
        }),
      ),
    ),
    Layer.provide(hostWith({ CELL_URL: "http://127.0.0.1:9", CELL_KEYS: settings.CELL_KEYS })),
    Layer.provide(HttpServer.layerServices),
  ),
  { disableLogger: true },
)

const server = Bun.serve({ hostname: "0.0.0.0", port: 0, fetch: (request) => api.handler(request) })
const runtime = ManagedRuntime.make(
  Layer.effect(
    Shared.Service,
    Effect.acquireRelease(
      Effect.promise(() => Celld.make({ ...Shared.vars(), REN_URL: `http://host.docker.internal:${server.port}` })),
      (instance) => Effect.promise(instance.dispose),
    ),
  ),
)
beforeAll(async () => {
  settings.CELL_URL = (await runtime.runPromise(Shared.Service)).url
}, 120_000)
afterAll(async () => {
  await runtime.dispose()
  await api.dispose()
  await server.stop(true)
})

const it = testEffect(Layer.unwrap(Effect.sync(() => hostWith(settings))))
const organizationId = Auth.OrganizationID.create()

describe("model refresh", () => {
  it.live("an expiring key is refreshed by the cell before the model call, through BrainHost.refreshModels", () =>
    Effect.gen(function* () {
      const brain = yield* BrainHost.Service
      const sessionId = Session.ID.create()
      const script = stub.script()
      const before = yield* Ref.get(granted)
      yield* brain.start(
        {
          sessionId,
          harness: "opencode",
          instructions: {},
          interactive: true,
          initialMessage: {
            messageId: Session.MessageID.create(),
            prompt: { text: `refresh ${script.marker}` },
            sender: { userId: "user_1" },
          },
        },
        organizationId,
      )
      const call = yield* Effect.promise(() => script.called())
      expect([call.authorization, (yield* Ref.get(granted)) - before]).toEqual([`Bearer sk-granted-${before + 2}`, 2])
    }),
  )

  it.live("refreshModels refuses tokens that are not valid host tokens", () =>
    Effect.gen(function* () {
      const brain = yield* BrainHost.Service
      const key = TestToken.keys[0]
      const exp = Math.floor(Date.now() / 1000) + 600
      const sid = Session.ID.create()
      const tokens = [
        "not-a-token",
        yield* SessionToken.sign(key, { sid, scope: "server", exp }),
        yield* SessionToken.sign(key, { sid, scope: "host", exp }),
        yield* SessionToken.sign(key, { sid, scope: "host", org: organizationId, exp: exp - 1200 }),
      ]
      const failures = yield* Effect.forEach(tokens, (token) => brain.refreshModels(token).pipe(Effect.flip))
      expect(failures.map((failure) => failure._tag)).toEqual(Array.from({ length: 4 }, () => "ForbiddenError"))
      const valid = yield* SessionToken.sign(key, { sid, scope: "host", org: organizationId, exp })
      const refreshed = yield* brain.refreshModels(valid)
      expect(refreshed.access.endpoints.map((endpoint) => endpoint.id)).toEqual(["stub"])
      const claims = yield* SessionToken.verify(TestToken.keys, refreshed.hostToken ?? "")
      const keyExpiresAt = refreshed.access.endpoints[0]?.apiKey.expiresAt
      expect(keyExpiresAt).toBeDefined()
      expect(Option.getOrThrow(claims).exp * 1000).toBeGreaterThanOrEqual(
        (keyExpiresAt ? DateTime.toEpochMillis(keyExpiresAt) : 0) + 2 * 60 * 60 * 1000 - 1000,
      )
    }),
  )
})
