import { describe, expect } from "bun:test"
import { Auth } from "@ren/schema/auth"
import { Signature } from "@ren/schema/signature"
import { ConfigProvider, Effect, Layer, Option, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { Billing } from "../src/billing.js"
import { Signer } from "../src/signer.js"
import { testEffect } from "./lib/effect.js"

const key = await Effect.runPromise(Signature.generate("ren-billing-test"))

const Claims = Schema.Struct({ kid: Schema.String, exp: Schema.Number, org: Schema.String })

const seen: { method: string; path: string; org: string; body: unknown }[] = []
let reply = 204

const billing = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const token = request.headers.get("authorization")?.replace(/^Bearer /u, "") ?? ""
    const claims = await Effect.runPromise(Signature.verify([key.publicKey], Claims, token))
    if (Option.isNone(claims)) return new Response(null, { status: 401 })
    seen.push({
      method: request.method,
      path: new URL(request.url).pathname,
      org: claims.value.org,
      body: await request.json(),
    })
    return new Response(null, { status: reply })
  },
})

const it = testEffect(
  Billing.layerConfig.pipe(
    Layer.provide([Signer.layerLocal, FetchHttpClient.layer]),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          REN_BILLING_URL: `http://127.0.0.1:${billing.port}`,
          REN_BILLING_KEYS: JSON.stringify([
            { id: key.privateKey.id, key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.privateKey.key) },
          ]),
        }),
      ),
    ),
  ),
)

const customer = { organizationId: Auth.OrganizationID.create(), name: "Asha's Org", ownerEmail: "asha@example.com" }

describe("Billing.layerRenCloud", () => {
  it.live("asks billing for the customer with a ren-billing token for the organization", () =>
    Effect.gen(function* () {
      const service = yield* Billing.Service
      seen.length = 0
      reply = 204

      yield* service.ensureCustomer(customer)

      expect(seen).toEqual([
        {
          method: "POST",
          path: "/billing/v1/customers",
          org: customer.organizationId,
          body: { name: "Asha's Org", ownerEmail: "asha@example.com" },
        },
      ])
    }),
  )

  it.live("fails with Billing.Unavailable when billing does not answer 204", () =>
    Effect.gen(function* () {
      const service = yield* Billing.Service
      reply = 503
      const failed = yield* Effect.flip(service.ensureCustomer(customer))
      expect(failed._tag).toBe("Billing.Unavailable")
    }),
  )
})
