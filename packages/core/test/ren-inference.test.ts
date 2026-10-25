import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Brain } from "@ren/schema/brain"
import { Signature } from "@ren/schema/signature"
import { and, eq } from "drizzle-orm"
import { ConfigProvider, Effect, Layer, Option, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { Models } from "../src/models.js"
import { RenInference } from "../src/ren-inference.js"
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

const modelInfo = {
  data: [{ model_name: "stub/stub-model", model_info: { model_key: "stub-model", provider_key: "stub" } }],
}
replies.set("/model/info", () => Response.json(modelInfo))

const service = Bun.serve({
  port: 0,
  fetch: async (request) => {
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
  Models.layerRenInference.pipe(
    Layer.provideMerge(RenInference.layer),
    Layer.provide([Signer.layerLocal, FetchHttpClient.layer]),
    Layer.provideMerge(Testing.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          REN_INFERENCE_URL: `http://127.0.0.1:${service.port}`,
          REN_INFERENCE_BRAIN_URL: "http://inference.brains.invalid",
          REN_INFERENCE_KEYS: JSON.stringify([
            { id: key.privateKey.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.privateKey.key) },
          ]),
        }),
      ),
    ),
  ),
)

describe("Models.layerRenInference", () => {
  it.live(
    "builds the grant from the service's /model/info and key, and attributes a session brain's key to the member who started it",
    () =>
      Effect.gen(function* () {
        const models = yield* Models.Service
        const database = yield* Database.Service
        const owner = yield* Seed.owner()
        const sessionId = yield* Seed.session(owner)
        const brainId = Brain.ofSession(sessionId)
        const expiresAt = new Date(Date.now() + 6 * 3600_000).toISOString()
        replies.set("/v1/keys", () => Response.json({ key: "key-brain", expiresAt }))
        seen.length = 0

        const granted = yield* models.grant(brainId, owner.organizationId)

        expect(granted.endpoints.map((endpoint) => [endpoint.id, endpoint.baseUrl])).toEqual([
          ["stub", "http://inference.brains.invalid/v1"],
        ])
        expect(granted.endpoints[0]?.models.map((model) => model.id)).toEqual(["stub-model"])
        expect(granted.endpoints.map((endpoint) => Redacted.value(endpoint.apiKey.key))).toEqual(["key-brain"])
        expect(granted.endpoints[0]?.apiKey.expiresAt?.epochMilliseconds).toBe(Date.parse(expiresAt))
        const member = (yield* database.db
          .select({ id: Database.Schema.member.id })
          .from(Database.Schema.member)
          .where(
            and(
              eq(Database.Schema.member.organizationId, owner.organizationId),
              eq(Database.Schema.member.userId, owner.createdBy),
            ),
          )).at(0)
        expect(seen).toEqual([
          { path: "/model/info", body: null, claims: expect.objectContaining({ org: owner.organizationId }) },
          {
            path: "/v1/keys",
            body: { brainId, attribution: "member" },
            claims: expect.objectContaining({ org: owner.organizationId, sub: owner.createdBy, member: member?.id }),
          },
        ])
      }),
  )

  it.live("attributes a space brain's key to the organization only, with no person in the token", () =>
    Effect.gen(function* () {
      const models = yield* Models.Service
      const owner = yield* Seed.owner()
      const brainId = Brain.ID.make(`brn_space_${crypto.randomUUID()}`)
      yield* Seed.session({ ...owner, brainId })
      replies.set("/v1/keys", () =>
        Response.json({ key: "key-brain", expiresAt: new Date(Date.now() + 3600_000).toISOString() }),
      )
      seen.length = 0

      yield* models.grant(brainId, owner.organizationId)

      const keys = seen.find((each) => each.path === "/v1/keys")
      expect(keys?.body).toEqual({ brainId, attribution: "org" })
      expect(keys?.claims.sub).toBeUndefined()
      expect(keys?.claims.member).toBeUndefined()
    }),
  )

  it.live("fails with Models.Unavailable on a key reply with no key, and on a 503", () =>
    Effect.gen(function* () {
      const models = yield* Models.Service
      const owner = yield* Seed.owner()
      const brainId = Brain.ofSession(yield* Seed.session(owner))

      replies.set("/v1/keys", () => Response.json({ expiresAt: new Date().toISOString() }))
      expect((yield* Effect.flip(models.grant(brainId, owner.organizationId)))._tag).toBe("Models.Unavailable")

      replies.set("/v1/keys", () => new Response("down", { status: 503 }))
      expect((yield* Effect.flip(models.grant(brainId, owner.organizationId)))._tag).toBe("Models.Unavailable")
    }),
  )
})
