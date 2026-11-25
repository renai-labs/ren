import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Signature } from "@ren/schema/signature"
import { Hand } from "@ren/schema/hand"
import { Space } from "@ren/schema/space"
import { ConfigProvider, DateTime, Duration, Effect, Fiber, Layer, Option, Redacted, Ref, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { Access } from "../src/access.js"
import { BrainClient } from "../src/brain-client.js"
import { CredentialSource } from "../src/credential-source.js"
import { GitHubApp } from "../src/github-app.js"
import type { Credentials } from "../src/credentials.js"
import { Drives } from "../src/drives.js"
import { Integrations } from "../src/integrations.js"
import { Models } from "../src/models.js"
import { Signer } from "../src/signer.js"
import { TestDrives } from "./lib/drives.js"
import { testEffect } from "./lib/effect.js"
import { ModelsStub } from "./lib/models-stub.js"

const key = await Effect.runPromise(Signature.generate("brain"))
const integrationsKey = await Effect.runPromise(Signature.generate("ren-integrations"))
const encodeKey = (generated: typeof key) =>
  JSON.stringify([
    { id: generated.privateKey.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(generated.privateKey.key) },
  ])

const failuresLeft = Ref.makeUnsafe(0)

const models = Layer.succeed(
  Models.Service,
  ModelsStub.of({
    catalog: () => Effect.succeed({ endpoints: [] }),
    providers: () => Effect.succeed([]),
    baseUrls: Effect.succeed([]),
    grant: () =>
      Effect.gen(function* () {
        if ((yield* Ref.getAndUpdate(failuresLeft, (left) => Math.max(0, left - 1))) > 0)
          return yield* new Models.Unavailable({ cause: new Error("upstream 503") })
        return Models.Access.make({
          endpoints: [
            {
              id: "anthropic",
              protocol: "anthropic-messages",
              baseUrl: "https://api.anthropic.com/v1",
              apiKey: {
                key: Redacted.make("sk-ant"),
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
    Layer.provide(Access.layer),
    Layer.provideMerge(Layer.mergeAll(models, GitHubApp.layerNone)),
    Layer.provideMerge(BrainClient.layer.pipe(Layer.provide(FetchHttpClient.layer))),
    Layer.provideMerge(Integrations.layer),
    Layer.provideMerge(Signer.layerLocal),
    Layer.provideMerge(Drives.layer.pipe(Layer.provide(Access.layer))),
    Layer.provideMerge(Testing.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          BRAIN_KEYS: encodeKey(key),
          REN_INTEGRATIONS_KEYS: encodeKey(integrationsKey),
          REN_URL: "https://api.ren.test",
          REN_PREVIOUS_HOSTS: "api.old.ren.test=api.ren.test",
          REN_INTEGRATIONS_URL: "https://mcp.ren.test",
          ...TestDrives.config,
        }),
      ),
    ),
  ),
)

const scope: Credentials.Scope = {
  organizationId: Auth.OrganizationID.make("org_01"),
  workload: { kind: "brain", id: Brain.ID.make("brn_01"), generation: 1 },
  spaceId: Option.some(Space.ID.make("spc_01")),
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
  it.effect("a brain that started before REN_URL changed still gets its token on the previous host", () =>
    Effect.gen(function* () {
      const candidates = yield* (yield* CredentialSource.Minted).candidates(scope, [])
      expect(candidates.find((candidate) => candidate.label === "REN")?.hosts).toEqual([
        "api.ren.test",
        "api.old.ren.test",
      ])
    }),
  )

  it.effect("a 5xx from the model provider is retried before the egress hears an error", () =>
    Effect.gen(function* () {
      yield* Ref.set(failuresLeft, 1)
      const fiber = yield* Effect.forkChild(modelKey)
      yield* TestClock.adjust(Duration.seconds(5))
      expect(yield* Fiber.join(fiber)).toEqual(Option.some("sk-ant"))
      expect(yield* Ref.get(failuresLeft)).toBe(0)
    }),
  )

  it.effect(
    "a remote hand gets DRIVE for its space's drive, which its executor mounts, and none of the brain's own keys",
    () =>
      Effect.gen(function* () {
        const source = yield* CredentialSource.Minted
        const hand = { ...scope, workload: { kind: "hand" as const, id: Hand.ID.make("env_01"), generation: 1 } }
        expect((yield* source.candidates(hand, [])).map((candidate) => candidate.label)).toEqual(["DRIVE"])
      }),
  )

  it.effect(
    "with REN_INTEGRATIONS_URL, a brain in a space gets INTEGRATIONS for its host: a token with org, space, brain, generation and expiry",
    () =>
      Effect.gen(function* () {
        const source = yield* CredentialSource.Minted
        const signer = yield* Signer.Service
        const found = (yield* source.candidates(scope, [])).find((candidate) => candidate.label === "INTEGRATIONS")
        expect(found).toMatchObject({ hosts: ["mcp.ren.test"], owner: "workload", inject: { op: "replace" } })
        if (!found) return
        const value = yield* source.value(found, scope)
        if (Option.isNone(value) || value.value.value.type !== "key") return yield* Effect.die(new Error("no key"))
        const claims = yield* Signature.verify(
          yield* signer.publicKeys("ren-integrations"),
          Schema.Struct({
            kid: Schema.String,
            org: Schema.String,
            space: Schema.String,
            brain: Schema.String,
            gen: Schema.Int,
            exp: Schema.Int,
          }),
          Redacted.value(value.value.value.value),
        )
        expect(claims).toEqual(
          Option.some({
            kid: integrationsKey.privateKey.id,
            org: "org_01",
            space: "spc_01",
            brain: "brn_01",
            gen: 1,
            exp: Math.floor(Duration.toSeconds(Duration.hours(1))),
          }),
        )
        const withoutUrl = yield* CredentialSource.Minted.pipe(
          Effect.flatMap((other) => other.candidates(scope, [])),
          Effect.provide(
            Layer.fresh(CredentialSource.layerMinted).pipe(
              Layer.provide([Access.layer, Layer.fresh(Integrations.layer)]),
              Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
            ),
          ),
        )
        expect(withoutUrl.map((candidate) => candidate.label)).not.toContain("INTEGRATIONS")
      }),
  )
})
