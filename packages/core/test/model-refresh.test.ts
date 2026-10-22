import { describe, expect, setDefaultTimeout } from "bun:test"
import { Shared } from "@ren/cell/testing"
import { Testing } from "@ren/db/testing"
import { Session } from "@ren/schema/session"
import { Effect, Layer, Ref } from "effect"
import { BrainRegistry } from "../src/brain-registry.js"
import { Models } from "../src/models.js"
import { SessionRunner } from "../src/session/runner.js"
import { testEffect } from "./lib/effect.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(60_000)

const stub = Shared.stub()
const minuteMs = 60_000
const granted = Ref.makeUnsafe(0)
const refreshes = Ref.makeUnsafe(0)

const models = Layer.succeed(
  Models.Service,
  Models.Service.of({
    catalog: () => Effect.succeed({ endpoints: [] }),
    grant: () =>
      Effect.gen(function* () {
        const count = yield* Ref.updateAndGet(granted, (value) => value + 1)
        const lifetimeMs = count === 1 ? 2 * minuteMs : 360 * minuteMs
        return Shared.access({ stub: Shared.apiKey(`sk-granted-${count}`, Date.now() + lifetimeMs) }, stub.url)
      }),
  }),
)

const it = testEffect(
  SessionRunner.layer.pipe(
    Layer.provideMerge(BrainRegistry.layer),
    Layer.provideMerge(
      Host.layerWith({}, models, Host.noEnvironments, (endpoint, effect) =>
        endpoint === "models.refresh" ? Effect.tap(effect, () => Ref.update(refreshes, (count) => count + 1)) : effect,
      ),
    ),
    Layer.provideMerge(Testing.layer),
  ),
)

describe("model refresh", () => {
  it.live("a key that expires within the refresh window is renewed through models.refresh before the model call", () =>
    Effect.gen(function* () {
      const sessions = yield* SessionRunner.Service
      const owner = yield* Seed.owner()
      const script = stub.script()
      yield* sessions.create(owner, {
        sessionId: Session.ID.create(),
        harness: "opencode",
        interactive: true,
        initialMessage: {
          messageId: Session.MessageID.create(),
          prompt: { text: `refresh ${script.marker}` },
          sender: { userId: owner.createdBy },
        },
      })
      const call = yield* Effect.promise(() => script.called())
      expect(call.authorization).not.toBe("Bearer sk-granted-1")
      expect(yield* Ref.get(refreshes)).toBeGreaterThan(0)
    }),
  )
})
