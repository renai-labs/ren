import { Shared } from "@ren/cell/testing"
import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
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
const revision = Ref.makeUnsafe("file-1")

const models = Layer.succeed(
  Models.Service,
  Models.Service.of({
    inference: Shared.inference(),
    catalog: () => Effect.succeed({ endpoints: [] }),
    revision: Ref.get(revision),
    grant: () =>
      Effect.gen(function* () {
        const wait = yield* Ref.get(latch)
        if (Option.isSome(wait)) yield* wait.value
        if ((yield* Ref.getAndUpdate(failuresLeft, (left) => Math.max(0, left - 1))) > 0)
          return yield* new Models.Unavailable({ cause: new Error("upstream 503") })
        const count = yield* Ref.updateAndGet(grants, (value) => value + 1)
        return Models.Access.make({
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
    Layer.provideMerge(Testing.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          BRAIN_KEYS: JSON.stringify([
            { id: key.privateKey.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.privateKey.key) },
          ]),
          REN_URL: "https://api.ren.test",
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
  const candidates = yield* source.candidates(scope, [])
  const found = candidates.find((candidate) => candidate.label === "MODELS")
  if (!found) return yield* Effect.die(new Error("no MODELS candidate"))
  expect(found).toMatchObject({ hosts: ["api.anthropic.com"], owner: "workload" })
  const value = yield* source.value(found, scope)
  return Option.map(value, (opened) => (opened.value.type === "key" ? Redacted.value(opened.value.value) : ""))
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

  it.effect("the old key is used until 20 minutes before its expiry, longer than the egress keeps an answer", () =>
    Effect.gen(function* () {
      yield* Ref.set(grants, 0)
      yield* Ref.set(failuresLeft, 0)
      expect(yield* modelKey).toEqual(Option.some("sk-ant-1"))
      yield* TestClock.adjust(Duration.minutes(5 * 60 + 39))
      expect(yield* modelKey).toEqual(Option.some("sk-ant-1"))
      yield* TestClock.adjust(Duration.minutes(2))
      expect(yield* modelKey).toEqual(Option.some("sk-ant-2"))
    }),
  )

  it.effect(
    "a changed model list (a new key or host in the grant) reaches the next request, not after the old key's lifetime",
    () =>
      Effect.gen(function* () {
        yield* Ref.set(grants, 0)
        yield* Ref.set(failuresLeft, 0)
        const before = yield* modelKey
        yield* Ref.set(revision, "file-2")
        const after = yield* modelKey
        expect([before, after]).toEqual([Option.some("sk-ant-1"), Option.some("sk-ant-2")])
      }),
  )

  it.effect("a brain gets REN for Ren's own host (REN_URL): its host token, in place of the placeholder", () =>
    Effect.gen(function* () {
      const source = yield* CredentialSource.Minted
      const ren = (yield* source.candidates(scope, [])).find((candidate) => candidate.label === "REN")
      expect(ren).toMatchObject({ hosts: ["api.ren.test"], inject: { op: "replace", in: ["header"] } })
      if (!ren) return
      const value = yield* source.value(ren, scope)
      if (Option.isNone(value) || value.value.value.type !== "key")
        return yield* Effect.die(new Error("expected a key"))
      expect(Redacted.value(value.value.value.value).slice(0, 2)).toBe("ey")
    }),
  )
})
