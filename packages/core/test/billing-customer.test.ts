import { describe, expect } from "bun:test"
import { Auth } from "@ren/schema/auth"
import { Signature } from "@ren/schema/signature"
import { Clock, ConfigProvider, Duration, Effect, Layer, Option, Queue, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { Billing } from "../src/billing.js"
import { BillingCustomer } from "../src/billing-customer.js"
import { DurableRunner } from "../src/durable-runner.js"
import { Signer } from "../src/signer.js"
import { testEffect } from "./lib/effect.js"

const key = await Effect.runPromise(Signature.generate("ren-billing-test"))

const Claims = Schema.Struct({ kid: Schema.String, exp: Schema.Number, org: Schema.String })

const refusals = new Map<string, number>()
const answered: { org: string; status: number }[] = []
const stored = new Map<string, PromiseWithResolvers<void>>()
const storedOf = (org: string) => {
  const found = stored.get(org) ?? Promise.withResolvers<void>()
  stored.set(org, found)
  return found
}
const testClockStart = Date.now() / 1000

const billing = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const token = request.headers.get("authorization")?.replace(/^Bearer /u, "") ?? ""
    const claims = await Effect.runPromise(
      Signature.verify([key.publicKey], Claims, token, { toleranceSeconds: testClockStart }),
    )
    const org = Option.match(claims, { onNone: () => "", onSome: (found) => found.org })
    const left = refusals.get(org) ?? 0
    refusals.set(org, left - 1)
    const status = left > 0 ? 503 : 204
    answered.push({ org, status })
    if (status === 204) storedOf(org).resolve()
    return new Response(null, { status })
  },
})

const customerLayer = BillingCustomer.layer.pipe(
  Layer.provide([Billing.layerRenCloud, DurableRunner.layerMemory]),
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
)

const it = testEffect(Layer.empty)

describe("BillingCustomer", () => {
  it.effect("retries until billing stores the customer; a second hook for the organization starts no second run", () =>
    Effect.gen(function* () {
      const sleeps = yield* Queue.unbounded<number>()
      const clock = yield* TestClock.testClockWith((testClock) =>
        Effect.succeed<Clock.Clock>({
          ...testClock,
          sleep: (duration) =>
            Queue.offer(sleeps, Duration.toMillis(duration)).pipe(Effect.andThen(testClock.sleep(duration))),
        }),
      )
      const retries: number[] = []
      yield* Queue.take(sleeps).pipe(
        Effect.flatMap((millis) =>
          millis < Duration.toMillis("15 seconds")
            ? Effect.sync(() => retries.push(millis)).pipe(Effect.andThen(TestClock.adjust(millis)))
            : Effect.void,
        ),
        Effect.forever,
        Effect.forkChild,
      )
      const organizationId = Auth.OrganizationID.create()
      const other = Auth.OrganizationID.create()
      const input = { organizationId, name: "Asha's Org", ownerEmail: "asha@example.com" }
      refusals.set(organizationId, 2)

      yield* Effect.gen(function* () {
        const customers = yield* BillingCustomer.Service
        yield* customers.ensure(input)
        yield* customers.ensure(input)
        yield* Effect.promise(() => storedOf(organizationId).promise)
        yield* customers.ensure(input)
        yield* customers.ensure({ ...input, organizationId: other })
        yield* Effect.promise(() => storedOf(other).promise)
      }).pipe(Effect.provide(customerLayer), Effect.provideService(Clock.Clock, clock))

      expect(answered.filter((each) => each.org === organizationId).map((each) => each.status)).toEqual([503, 503, 204])
      expect(retries).toEqual([1000, 2000])
    }),
  )
})
