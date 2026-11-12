import { describe, expect } from "bun:test"
import { Auth } from "@ren/schema/auth"
import { Signature } from "@ren/schema/signature"
import { ConfigProvider, DateTime, Effect, Layer, Option, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { Billing } from "../src/billing.js"
import { Signer } from "../src/signer.js"
import { testEffect } from "./lib/effect.js"

const key = await Effect.runPromise(Signature.generate("ren-billing-test"))

const Claims = Schema.Struct({ kid: Schema.String, exp: Schema.Number, org: Schema.String })

const seen: { method: string; path: string; org: string; body: unknown }[] = []
let reply = () => new Response(null, { status: 204 })

const billing = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const token = request.headers.get("authorization")?.replace(/^Bearer /u, "") ?? ""
    const claims = await Effect.runPromise(Signature.verify([key.publicKey], Claims, token))
    if (Option.isNone(claims)) return new Response(null, { status: 401 })
    const url = new URL(request.url)
    const text = await request.text()
    seen.push({
      method: request.method,
      path: `${url.pathname}${url.search}`,
      org: claims.value.org,
      body: text ? JSON.parse(text) : null,
    })
    return reply()
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
      reply = () => new Response(null, { status: 204 })

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
      reply = () => new Response(null, { status: 503 })
      const failed = yield* Effect.flip(service.ensureCustomer(customer))
      expect(failed._tag).toBe("Billing.Unavailable")
    }),
  )

  it.live("reads a page of invoices for the organization", () =>
    Effect.gen(function* () {
      const service = yield* Billing.Service
      seen.length = 0
      reply = () =>
        Response.json({
          invoices: [
            {
              id: "pay_1",
              number: "inv_1",
              status: "paid",
              amountCents: 15000,
              currency: "USD",
              issuedAt: "2026-11-03T10:00:00.000Z",
            },
          ],
          nextPage: 3,
        })

      const page = yield* service.invoices(customer.organizationId, { page: 2, perPage: 1 })

      expect(seen.map((each) => [each.method, each.path, each.org])).toEqual([
        ["GET", "/billing/v1/invoices?page=2&perPage=1", customer.organizationId],
      ])
      expect(page.nextPage).toBe(3)
      expect(page.invoices.map((invoice) => DateTime.formatIso(invoice.issuedAt))).toEqual(["2026-11-03T10:00:00.000Z"])
    }),
  )

  it.live("answers each code of billing with the error and the text that a person reads", () =>
    Effect.gen(function* () {
      const service = yield* Billing.Service
      const cases = [
        [400, "invalid_plan", "Primitive.Invalid", "Unknown plan."],
        [400, "already_subscribed", "Primitive.Invalid", "This organization already has a plan. Change it instead."],
        [400, "no_subscription", "Primitive.Invalid", "No active subscription to change."],
        [400, "not_enrolled", "Primitive.Invalid", "Billing is not set up for this organization."],
        [400, "provider_refused", "Primitive.Invalid", "Couldn’t update your plan. Please try again."],
        [
          409,
          "plan_change_pending",
          "Primitive.Conflict",
          "A previous payment is still processing — please try again shortly.",
        ],
        [404, "not_found", "Primitive.NotFound", "Invoice not found."],
        [503, "unavailable", "Billing.Unavailable", "Billing is not available now. Try again later."],
      ] as const

      const answers = yield* Effect.forEach(cases, ([status, error]) => {
        reply = () => Response.json({ error }, { status })
        return Effect.flip(service.changePlan(customer.organizationId, { plan: "pro" }))
      })

      expect(answers.map((failure) => [failure._tag, failure.message])).toEqual(
        cases.map(([, , tag, message]) => [tag, message]),
      )
    }),
  )
})
