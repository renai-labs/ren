import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Brain } from "@ren/schema/brain"
import { Signature } from "@ren/schema/signature"
import { ConfigProvider, Effect, Layer, Option, Redacted, Schema, Struct } from "effect"
import { FetchHttpClient } from "effect/http"
import { Access } from "../src/access.js"
import { Models } from "../src/models.js"
import { RenInference } from "../src/ren-inference.js"
import { RenInferenceProvider } from "../src/ren-inference/provider.js"
import { Signer } from "../src/signer.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const key = await Effect.runPromise(Signature.generate("ren-inference-test"))
const publicKeys = [key.publicKey]

const Claims = Schema.Struct({
  kid: Schema.String,
  exp: Schema.Number,
  org: Schema.String,
  sub: Schema.optional(Schema.String),
  member: Schema.optional(Schema.String),
})

type Seen = { claims: typeof Claims.Type; body: unknown; path: string }

const seen: Seen[] = []
const replies = new Map<string, () => Response>()

const discovery: Readonly<Record<string, unknown>> = {
  "/v1/catalog": {
    baseUrl: "https://llm.ren.test/v1",
    models: [{ id: "opaque-chat", type: "chat", protocol: "openai-chat" }],
  },
  "/v1/search/providers": [{ id: "ren/search", name: "Search" }],
}
const catalogReads: Array<string | null> = []

const service = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const found = discovery[new URL(request.url).pathname]
    if (found) {
      catalogReads.push(request.headers.get("authorization"))
      if (request.headers.get("authorization") !== "Bearer catalog-key") return new Response(null, { status: 401 })
      return Response.json(found)
    }
    const token = request.headers.get("authorization")?.replace(/^Bearer /u, "") ?? ""
    const claims = await Effect.runPromise(Signature.verify(publicKeys, Claims, token))
    if (Option.isNone(claims)) return new Response(null, { status: 401 })
    const body: unknown = request.method === "GET" || request.method === "DELETE" ? null : await request.json()
    const path = new URL(request.url).pathname
    seen.push({ claims: claims.value, body, path })
    return (replies.get(path) ?? (() => new Response(null, { status: 404 })))()
  },
})

const it = testEffect(
  Models.layer([RenInferenceProvider.make]).pipe(
    Layer.provideMerge(RenInference.layer),
    Layer.provide([Signer.layerLocal, FetchHttpClient.layer, Access.layer]),
    Layer.provideMerge(Testing.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          REN_INFERENCE_URL: `http://127.0.0.1:${service.port}`,
          REN_INFERENCE_BRAIN_URL: "https://llm.ren.test",
          REN_INFERENCE_GATEWAY_KEY: "catalog-key",
          REN_INFERENCE_KEYS: JSON.stringify([
            { id: key.privateKey.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.privateKey.key) },
          ]),
        }),
      ),
    ),
  ),
)

describe("RenInferenceProvider with the Ren Inference Service", () => {
  it.live(
    "reads the shared catalog with the deployment key and grants the catalog's one base URL with a brain key",
    () =>
      Effect.gen(function* () {
        const models = yield* Models.Service
        const owner = yield* Seed.owner()
        const brainId = Brain.ofSession(yield* Seed.session(owner))
        const expiresAt = new Date(Date.now() + 6 * 3600_000).toISOString()
        replies.set("/v1/keys", () => Response.json({ key: "key-brain", expiresAt }))
        seen.length = 0

        const granted = yield* models.grant(brainId, owner.organizationId, owner.spaceId)
        const catalog = yield* models.catalog(owner.organizationId)

        expect(granted.endpoints.map((endpoint) => [endpoint.id, endpoint.baseUrl])).toEqual([
          ["ren", "https://llm.ren.test/v1"],
        ])
        expect(granted.endpoints[0]?.models).toEqual([])
        expect(catalog.endpoints[0]?.models.map((model) => model.id)).toEqual(["opaque-chat"])
        expect(catalog.endpoints[0]?.search).toEqual([{ id: "ren/search", name: "Search" }])
        expect(catalogReads.slice(-2)).toEqual(["Bearer catalog-key", "Bearer catalog-key"])
        expect(granted.endpoints.map((endpoint) => Redacted.value(endpoint.apiKey.key))).toEqual(["key-brain"])
        expect(granted.endpoints[0]?.apiKey.expiresAt?.epochMilliseconds).toBe(Date.parse(expiresAt))
        expect(seen.map((each) => [each.path, each.body, Struct.omit(each.claims, ["kid", "exp"])])).toEqual([
          ["/v1/keys", { brainId, spaceId: owner.spaceId }, { org: owner.organizationId }],
        ])
      }),
  )

  it.live("fails with Models.Unavailable on a key reply with no key, and on a 503", () =>
    Effect.gen(function* () {
      const models = yield* Models.Service
      const owner = yield* Seed.owner()
      const brainId = Brain.ofSession(yield* Seed.session(owner))

      replies.set("/v1/keys", () => Response.json({ expiresAt: new Date().toISOString() }))
      expect((yield* Effect.flip(models.grant(brainId, owner.organizationId, owner.spaceId)))._tag).toBe(
        "Models.Unavailable",
      )

      replies.set("/v1/keys", () => new Response("down", { status: 503 }))
      expect((yield* Effect.flip(models.grant(brainId, owner.organizationId, owner.spaceId)))._tag).toBe(
        "Models.Unavailable",
      )
    }),
  )
})
