import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Celld, Shared, TestToken } from "@ren/cell/testing"
import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { Effect, Layer, ManagedRuntime, Ref } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { BrainHost } from "../src/brain-host.js"
import { Models } from "../src/models.js"
import { testEffect } from "./lib/effect.js"
import { RenHostApiTest } from "./lib/ren-host-api.js"
import { Host } from "./lib/host.js"

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

const api = HttpRouter.toWebHandler(
  RenHostApiTest.layer().pipe(
    Layer.provide(Host.layer({ CELL_URL: "http://127.0.0.1:9", CELL_KEYS: settings.CELL_KEYS }, models)),
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

const it = testEffect(Layer.unwrap(Effect.sync(() => Host.layer(settings, models))))
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
          interactive: true,
          initialMessage: {
            messageId: Session.MessageID.create(),
            prompt: { text: `refresh ${script.marker}` },
            sender: { userId: "user_1" },
          },
        },
        { organizationId, spaceId: Space.ID.create() },
      )
      const call = yield* Effect.promise(() => script.called())
      expect([call.authorization, (yield* Ref.get(granted)) - before]).toEqual([`Bearer sk-granted-${before + 2}`, 2])
    }),
  )
})
