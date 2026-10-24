import { describe, expect } from "bun:test"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Models as ModelsSchema } from "@ren/schema/models"
import { Signature } from "@ren/schema/signature"
import {
  ConfigProvider,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Redacted,
  Ref,
  Schema,
} from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { BrainClient } from "../src/brain-client.js"
import { CredentialSource } from "../src/credential-source.js"
import type { Credentials } from "../src/credentials.js"
import { Models } from "../src/models.js"
import { Signer } from "../src/signer.js"
import { testEffect } from "./lib/effect.js"

const key = await Effect.runPromise(Signature.generate("brain"))

const grants = Ref.makeUnsafe(0)
const failuresLeft = Ref.makeUnsafe(0)
const latch = Ref.makeUnsafe(Option.none<Effect.Effect<void>>())

const models = Layer.succeed(
  Models.Service,
  Models.Service.of({
    catalog: () => Effect.succeed({ endpoints: [] }),
    grant: () =>
      Effect.gen(function* () {
        const wait = yield* Ref.get(latch)
        if (Option.isSome(wait)) yield* wait.value
        if ((yield* Ref.getAndUpdate(failuresLeft, (left) => Math.max(0, left - 1))) > 0)
          return yield* new Models.Unavailable({ cause: new Error("upstream 503") })
        const count = yield* Ref.updateAndGet(grants, (value) => value + 1)
        return ModelsSchema.Access.make({
          endpoints: [
            {
              id: "anthropic",
              protocol: "anthropic-messages",
              baseUrl: "https://api.anthropic.com/v1",
              apiKey: {
                key: Redacted.make(`sk-ant-${count}`),
                expiresAt: DateTime.addDuration(yield* DateTime.now, Duration.hours(6)),
              },
              models: [],
            },
          ],
        })
      }),
  }),
)

const it = testEffect(
  CredentialSource.layerMinted.pipe(
    Layer.provideMerge(models),
    Layer.provideMerge(BrainClient.layer.pipe(Layer.provide(Signer.layerLocal), Layer.provide(FetchHttpClient.layer))),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          BRAIN_KEYS: JSON.stringify([
            { id: key.privateKey.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.privateKey.key) },
          ]),
          REN_EGRESS_UPSTREAM: "http://ren-server:4000",
        }),
      ),
    ),
  ),
)

const scope: Credentials.Scope = {
  organizationId: Auth.OrganizationID.make("org_01"),
  workload: { kind: "brain", id: Brain.ID.make("brn_01"), generation: 1 },
  spaceId: Option.none(),
  person: Option.none(),
}

const modelKey = Effect.gen(function* () {
  const source = yield* CredentialSource.Minted
  const candidates = yield* source.candidates(scope)
  const found = candidates.find((candidate) => candidate.label === "MODELS")
  if (!found) return yield* Effect.die(new Error("no MODELS candidate"))
  expect(found).toMatchObject({ hosts: ["api.anthropic.com"], pathPrefix: "/v1", owner: "workload" })
  const value = yield* source.value(found, scope)
  return Option.map(value, (opened) => (opened.type === "key" ? Redacted.value(opened.value) : ""))
})

describe("CredentialSource.layerMinted", () => {
  it.effect("two mints of MODELS for one brain at once make one upstream mint; a 5xx is retried", () =>
    Effect.gen(function* () {
      yield* Ref.set(grants, 0)
      yield* Ref.set(failuresLeft, 1)
      const gate = yield* Deferred.make<void>()
      yield* Ref.set(latch, Option.some(Deferred.await(gate)))
      const first = yield* Effect.forkChild(modelKey)
      const second = yield* Effect.forkChild(modelKey)
      yield* Effect.yieldNow
      yield* Ref.set(latch, Option.none())
      yield* Deferred.succeed(gate, undefined)
      yield* TestClock.adjust(Duration.seconds(5))
      expect(yield* Fiber.join(first)).toEqual(Option.some("sk-ant-1"))
      expect(yield* Fiber.join(second)).toEqual(Option.some("sk-ant-1"))
      expect(yield* Ref.get(grants)).toBe(1)
    }),
  )

  it.effect("the old key is used until shortly before its expiry, then Ren mints a new one", () =>
    Effect.gen(function* () {
      yield* Ref.set(grants, 0)
      yield* Ref.set(failuresLeft, 0)
      expect(yield* modelKey).toEqual(Option.some("sk-ant-1"))
      yield* TestClock.adjust(Duration.hours(5))
      expect(yield* modelKey).toEqual(Option.some("sk-ant-1"))
      yield* TestClock.adjust(Duration.minutes(56))
      expect(yield* modelKey).toEqual(Option.some("sk-ant-2"))
    }),
  )

  it.effect("a brain gets REN for ren.internal: its host token, routed to Ren's address", () =>
    Effect.gen(function* () {
      const source = yield* CredentialSource.Minted
      const ren = (yield* source.candidates(scope)).find((candidate) => candidate.label === "REN")
      expect(ren).toMatchObject({ hosts: ["ren.internal"], inject: { op: "route" } })
      if (!ren) return
      const value = yield* source.value(ren, scope)
      if (Option.isNone(value) || value.value.type !== "route") return yield* Effect.die(new Error("expected a route"))
      expect(Redacted.value(value.value.upstream)).toBe("http://ren-server:4000")
      expect(
        Object.entries(value.value.headers).map((header) => [header[0], Redacted.value(header[1]).slice(0, 9)]),
      ).toEqual([["Authorization", "Bearer ey"]])
    }),
  )
})
