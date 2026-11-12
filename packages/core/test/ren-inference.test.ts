import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Signature } from "@ren/schema/signature"
import { ConfigProvider, DateTime, Effect, Layer, Option, Redacted, Schema, Struct } from "effect"
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

type Seen = { claims: typeof Claims.Type; body: unknown; path: string; method: string }

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
    seen.push({ claims: claims.value, body, path, method: request.method })
    return (
      replies.get(`${request.method} ${path}`) ??
      replies.get(path) ??
      (() => new Response(null, { status: 404 }))
    )()
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

const DAY_MS = 24 * 60 * 60 * 1000

const upstreamKey = (id: string, ownerMemberId: string) => ({
  id,
  name: `key ${id}`,
  prefix: "sk-ren-7Hq2",
  status: "active",
  ownerMemberId,
  expiresAt: null,
  createdAt: "2026-10-02T08:00:00.000Z",
})

// oxlint-disable-next-line ren/no-comments -- An org with an owner and two members, Ada and Bo, one key each.
const keyOrg = Effect.fnUntraced(function* () {
  const organizationId = yield* Seed.organization()
  const person = Effect.fnUntraced(function* (name: string, role: string) {
    const user = yield* Seed.user({ name })
    const memberId = yield* Seed.member(organizationId, user.id, role)
    return { memberId, actor: { userId: user.id, organizationId, roles: [role] } }
  })
  const owner = yield* person("Olu", "owner")
  const ada = yield* person("Ada", "member")
  const bo = yield* person("Bo", "member")
  replies.set("GET /v1/inference-keys", () =>
    Response.json({
      baseUrl: "https://llm.ren.test",
      keys: [upstreamKey("ifk_bo", bo.memberId), upstreamKey("ifk_ada", ada.memberId)],
    }),
  )
  replies.set("GET /v1/inference-keys/ifk_ada/secret", () =>
    Response.json({ secret: "sk-ren-ada", baseUrl: "https://llm.ren.test" }),
  )
  replies.set("DELETE /v1/inference-keys/ifk_ada", () => new Response(null, { status: 204 }))
  replies.set("DELETE /v1/inference-keys/ifk_bo", () => new Response(null, { status: 204 }))
  seen.length = 0
  return { organizationId, owner, ada, bo }
})

const call = Effect.fnUntraced(function* (input: {
  readonly organizationId: Auth.OrganizationID
  readonly key: string
  readonly member: string
  readonly daysAgo: number
  readonly payer?: "ren" | "customer"
  readonly cost?: number
  readonly failed?: boolean
}) {
  const database = yield* Database.Service
  yield* database.db.insert(Database.Schema.usage_event).values({
    source: "ren-inference",
    id: crypto.randomUUID(),
    type: "model.call",
    time: new Date(Date.now() - input.daysAgo * DAY_MS),
    workload: `inference-key:${input.key}`,
    organization: input.organizationId,
    member: input.member,
    payer: input.payer ?? "ren",
    provider: "anthropic",
    ...(input.failed ? { error: { status: 429, message: "rate limited" } } : { cost_micro_usd: input.cost ?? 1000 }),
    data: {
      requested_model: "anthropic/claude-opus-5-5",
      served_model: "anthropic/claude-opus-5-5-ren",
      ...(input.failed
        ? {}
        : { input_tokens: 100, output_tokens: 10, cache_write_tokens: 4, cache_write_1h_tokens: 1 }),
    },
  })
})

describe("inference keys", () => {
  it.live("shows a member only their own keys, with the owner's name and the last call from usage_event", () =>
    Effect.gen(function* () {
      const inference = yield* RenInference.Service
      const org = yield* keyOrg()
      yield* call({ organizationId: org.organizationId, key: "ifk_ada", member: org.ada.memberId, daysAgo: 400 })
      yield* call({ organizationId: org.organizationId, key: "ifk_ada", member: org.ada.memberId, daysAgo: 2 })

      const listed = yield* inference.keys(org.ada.actor)

      expect(listed.baseUrl).toBe("https://llm.ren.test")
      expect(listed.keys.map((key) => [key.id, key.owner.name, key.canRevoke])).toEqual([["ifk_ada", "Ada", true]])
      const last = listed.keys.at(0)?.lastUsedAt
      expect(last ? DateTime.toEpochMillis(last) : 0).toBeGreaterThan(Date.now() - 3 * DAY_MS)
      expect(seen.map((each) => Struct.omit(each.claims, ["kid", "exp"]))).toEqual([
        { org: org.organizationId, sub: org.ada.actor.userId, member: org.ada.memberId },
      ])
    }),
  )

  it.live("answers 404 when a member revokes or reads another member's key, and never asks the service", () =>
    Effect.gen(function* () {
      const inference = yield* RenInference.Service
      const org = yield* keyOrg()

      expect((yield* Effect.flip(inference.revokeKey(org.ada.actor, "ifk_bo")))._tag).toBe("Primitive.NotFound")
      expect((yield* Effect.flip(inference.keySecret(org.ada.actor, "ifk_bo")))._tag).toBe("Primitive.NotFound")
      yield* inference.revokeKey(org.ada.actor, "ifk_ada")

      expect(seen.filter((each) => each.method === "DELETE").map((each) => each.path)).toEqual([
        "/v1/inference-keys/ifk_ada",
      ])
    }),
  )

  it.live("lets an admin see and revoke every key, but not read another member's secret", () =>
    Effect.gen(function* () {
      const inference = yield* RenInference.Service
      const org = yield* keyOrg()

      const listed = yield* inference.keys(org.owner.actor)
      expect(listed.keys.map((key) => [key.id, key.owner.name, key.canRevoke])).toEqual([
        ["ifk_bo", "Bo", true],
        ["ifk_ada", "Ada", true],
      ])
      yield* inference.revokeKey(org.owner.actor, "ifk_bo")
      expect((yield* Effect.flip(inference.keySecret(org.owner.actor, "ifk_ada")))._tag).toBe("Primitive.Forbidden")
      expect(yield* inference.keySecret(org.ada.actor, "ifk_ada")).toEqual({
        secret: "sk-ren-ada",
        baseUrl: "https://llm.ren.test",
      })
    }),
  )

  it.live("reads usage of the keys that key.view allows, in the period, with no call to the service", () =>
    Effect.gen(function* () {
      const inference = yield* RenInference.Service
      const org = yield* keyOrg()
      const ada = { organizationId: org.organizationId, key: "ifk_ada", member: org.ada.memberId }
      yield* call({ ...ada, daysAgo: 1, cost: 52_100 })
      yield* call({ ...ada, daysAgo: 1, payer: "customer", cost: 0 })
      yield* call({ ...ada, daysAgo: 1, failed: true })
      yield* call({ ...ada, daysAgo: 40, cost: 7 })
      yield* call({ organizationId: org.organizationId, key: "ifk_bo", member: org.bo.memberId, daysAgo: 1 })

      const own = yield* inference.keyUsage(org.ada.actor, "30d")
      const every = yield* inference.keyUsage(org.owner.actor, "all")

      expect(own).toEqual([
        {
          keyId: "ifk_ada",
          charged: 52_100,
          calls: 3,
          failed: 1,
          models: [
            {
              model: "anthropic/claude-opus-5-5",
              payer: "customer",
              calls: 1,
              failed: 0,
              inputTokens: 100,
              outputTokens: 10,
              reasoningTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 5,
              cost: 0,
            },
            {
              model: "anthropic/claude-opus-5-5",
              payer: "ren",
              calls: 2,
              failed: 1,
              inputTokens: 100,
              outputTokens: 10,
              reasoningTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 5,
              cost: 52_100,
            },
          ],
        },
      ])
      expect(
        every
          .map((usage) => [usage.keyId, usage.calls, usage.charged])
          .toSorted((left, right) => String(left.at(0)).localeCompare(String(right.at(0)))),
      ).toEqual([
        ["ifk_ada", 4, 52_107],
        ["ifk_bo", 1, 1000],
      ])
      expect(seen).toEqual([])
    }),
  )
})
