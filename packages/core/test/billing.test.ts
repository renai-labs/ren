import { describe, expect } from "bun:test"
import { Auth } from "@ren/schema/auth"
import { Signature } from "@ren/schema/signature"
import { ConfigProvider, Effect, Layer, Option, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { Billing } from "../src/billing.js"
import { Signer } from "../src/signer.js"
import { testEffect } from "./lib/effect.js"

const billingKey = await Effect.runPromise(Signature.generate("ren-billing-test"))
const inferenceKey = await Effect.runPromise(Signature.generate("ren-inference-test"))

const Claims = Schema.Struct({ kid: Schema.String, exp: Schema.Number, org: Schema.String })

const seen: { method: string; path: string; org: string; body: unknown }[] = []
const replies = new Map<string, number>()

const billing = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const token = request.headers.get("authorization")?.replace(/^Bearer /u, "") ?? ""
    const claims = await Effect.runPromise(Signature.verify([billingKey.publicKey], Claims, token))
    if (Option.isNone(claims)) return new Response(null, { status: 401 })
    const path = new URL(request.url).pathname
    const body: unknown = request.headers.get("content-type") ? await request.json() : null
    seen.push({ method: request.method, path, org: claims.value.org, body })
    return new Response(null, { status: replies.get(path) ?? 204 })
  },
})

const keys = (key: Signature.PrivateKey) =>
  JSON.stringify([{ id: key.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.key) }])

const layerWith = (variables: Record<string, string>) =>
  Billing.layerConfig.pipe(
    Layer.provide([Signer.layerLocal, FetchHttpClient.layer]),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(variables))),
  )

const it = testEffect(
  layerWith({ REN_BILLING_URL: `http://127.0.0.1:${billing.port}`, REN_BILLING_KEYS: keys(billingKey.privateKey) }),
)

const organizationId = Auth.OrganizationID.create()

describe("Billing.layerRenCloud", () => {
  it.live("sends each call for the organization with a ren-billing token", () =>
    Effect.gen(function* () {
      const service = yield* Billing.Service
      seen.length = 0
      replies.clear()

      yield* service.ensureCustomer(organizationId, { name: "Asha's Org", ownerEmail: "asha@example.com" })
      yield* service.check(organizationId)
      yield* service.removeOrganization(organizationId)

      expect(seen).toEqual([
        {
          method: "POST",
          path: "/billing/v1/customers",
          org: organizationId,
          body: { name: "Asha's Org", ownerEmail: "asha@example.com" },
        },
        { method: "POST", path: "/billing/v1/check", org: organizationId, body: null },
        { method: "DELETE", path: `/billing/v1/organizations/${organizationId}`, org: organizationId, body: null },
      ])
    }),
  )

  it.live("check refuses with insufficient_credits on 402, and budget_unreadable on any other answer", () =>
    Effect.gen(function* () {
      const service = yield* Billing.Service
      const reason = (status: number) => {
        replies.set("/billing/v1/check", status)
        return service.check(organizationId).pipe(
          Effect.flip,
          Effect.map((refused) => refused.reason),
        )
      }
      expect(yield* reason(402)).toBe("insufficient_credits")
      expect(yield* reason(503)).toBe("budget_unreadable")
      expect(yield* reason(401)).toBe("budget_unreadable")
    }),
  )

  it.live("ensureCustomer fails with Billing.Unavailable when billing does not store the customer", () =>
    Effect.gen(function* () {
      const service = yield* Billing.Service
      replies.set("/billing/v1/customers", 503)
      const failed = yield* Effect.flip(service.ensureCustomer(organizationId, { name: "Org", ownerEmail: "a@b.co" }))
      expect(failed._tag).toBe("Billing.Unavailable")
    }),
  )
})

describe("Billing.layerConfig", () => {
  testEffect(
    layerWith({
      REN_BILLING_URL: `http://127.0.0.1:${billing.port}`,
      REN_INFERENCE_KEYS: keys(inferenceKey.privateKey),
    }),
  ).live("with no REN_BILLING_KEYS, a check is refused as unreadable, not allowed", () =>
    Effect.gen(function* () {
      const service = yield* Billing.Service
      const refused = yield* Effect.flip(service.check(organizationId))
      expect(refused.reason).toBe("budget_unreadable")
    }),
  )

  testEffect(layerWith({})).live("with no REN_BILLING_URL, it is layerNone: every call succeeds", () =>
    Effect.gen(function* () {
      const service = yield* Billing.Service
      yield* service.ensureCustomer(organizationId, { name: "Org", ownerEmail: "a@b.co" })
      yield* service.check(organizationId)
      yield* service.removeOrganization(organizationId)
    }),
  )
})
