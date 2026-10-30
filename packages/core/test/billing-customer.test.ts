import { describe, expect } from "bun:test"
import { Auth } from "@ren/schema/auth"
import { Deferred, Effect, Layer, Queue, Ref } from "effect"
import { TestClock } from "effect/testing"
import { Billing } from "../src/billing.js"
import { BillingCustomer } from "../src/billing-customer.js"
import { DurableRunner } from "../src/durable-runner.js"
import { testEffect } from "./lib/effect.js"

const it = testEffect(Layer.empty)

describe("BillingCustomer", () => {
  it.effect("asks billing again until billing stores the customer", () =>
    Effect.gen(function* () {
      const asked = yield* Queue.unbounded<Billing.Customer>()
      const refusals = yield* Ref.make(2)
      const stored = yield* Deferred.make<void>()
      const billing = Layer.succeed(
        Billing.Service,
        Billing.Service.of({
          ensureCustomer: (customer) =>
            Queue.offer(asked, customer).pipe(
              Effect.andThen(Ref.getAndUpdate(refusals, (left) => left - 1)),
              Effect.flatMap((left) =>
                left > 0
                  ? Effect.fail(new Billing.Unavailable({ message: "Billing answered 503." }))
                  : Deferred.succeed(stored, undefined),
              ),
            ),
        }),
      )
      const customer = {
        organizationId: Auth.OrganizationID.create(),
        name: "Asha's Org",
        ownerEmail: "asha@example.com",
      }

      yield* Effect.gen(function* () {
        const customers = yield* BillingCustomer.Service
        yield* customers.ensure(customer)
        yield* Queue.take(asked)
        yield* TestClock.adjust("1 minute")
        yield* Deferred.await(stored)
      }).pipe(Effect.provide(BillingCustomer.layer.pipe(Layer.provide([billing, DurableRunner.layerMemory]))))

      expect(yield* Queue.takeAll(asked)).toEqual([customer, customer])
    }),
  )
})
