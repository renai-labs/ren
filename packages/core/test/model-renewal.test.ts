import { afterAll, beforeAll, describe, expect, setDefaultTimeout } from "bun:test"
import { RenewalApi } from "@ren/brain-api/renewal-api"
import { SessionToken } from "@ren/brain-api/session-token"
import { Celld, Shared, TestToken } from "@ren/cell/testing"
import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import { ConfigProvider, Effect, Layer, ManagedRuntime, Ref } from "effect"
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
    renewIfDue: () => Effect.succeedNone,
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

const renewal = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(RenewalApi).pipe(
    Layer.provide(
      HttpApiBuilder.group(RenewalApi, "renewal", (handlers) =>
        Effect.gen(function* () {
          const brain = yield* BrainHost.Service
          return handlers.handle("renewal.models", (request) =>
            brain.renewModels(request.headers.authorization.replace(/^Bearer /u, "")),
          )
        }),
      ),
    ),
    Layer.provide(hostWith({ CELL_URL: "http://127.0.0.1:9", CELL_KEYS: settings.CELL_KEYS })),
    Layer.provide(HttpServer.layerServices),
  ),
  { disableLogger: true },
)

const server = Bun.serve({ hostname: "0.0.0.0", port: 0, fetch: (request) => renewal.handler(request) })
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
  await renewal.dispose()
  await server.stop(true)
})

const it = testEffect(Layer.unwrap(Effect.sync(() => hostWith(settings))))
const organizationId = Auth.OrganizationID.create()

describe("model renewal", () => {
  it.live("an expiring key is renewed by the cell before the model call, through BrainHost.renewModels", () =>
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
            prompt: { text: `renew ${script.marker}` },
            sender: { userId: "user_1" },
          },
        },
        organizationId,
      )
      const call = yield* Effect.promise(() => script.called())
      expect([call.authorization, (yield* Ref.get(granted)) - before]).toEqual([`Bearer sk-granted-${before + 2}`, 2])
    }),
  )

  it.live("renewModels refuses tokens that are not valid renewal tokens", () =>
    Effect.gen(function* () {
      const brain = yield* BrainHost.Service
      const key = TestToken.keys[0]
      const exp = Math.floor(Date.now() / 1000) + 600
      const sid = Session.ID.create()
      const tokens = [
        "not-a-token",
        yield* SessionToken.sign(key, { sid, scope: "server", exp }),
        yield* SessionToken.sign(key, { sid, scope: "renewal", exp }),
        yield* SessionToken.sign(key, { sid, scope: "renewal", org: organizationId, exp: exp - 1200 }),
      ]
      const failures = yield* Effect.forEach(tokens, (token) => brain.renewModels(token).pipe(Effect.flip))
      expect(failures.map((failure) => failure._tag)).toEqual(Array.from({ length: 4 }, () => "ForbiddenError"))
      const valid = yield* SessionToken.sign(key, { sid, scope: "renewal", org: organizationId, exp })
      const renewed = yield* brain.renewModels(valid)
      expect(renewed.renewalToken).toBeString()
      expect(renewed.access.endpoints.map((endpoint) => endpoint.id)).toEqual(["stub"])
    }),
  )
})
