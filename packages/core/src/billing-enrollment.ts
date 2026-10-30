export * as BillingEnrollment from "./billing-enrollment.js"

import { Context, Effect, Layer } from "effect"
import { Billing } from "./billing.js"
import { DurableRunner } from "./durable-runner.js"

export interface Interface {
  readonly enroll: (customer: Billing.Customer) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/BillingEnrollment") {}

// oxlint-disable-next-line ren/no-comments -- One durable run per organization, so billing gets its customer even when billing is down when the organization is created. Until the run succeeds, the organization has no credit.
const EnrollRun = DurableRunner.make("BillingEnrollment", {
  payload: Billing.Customer,
  idempotencyKey: (customer) => `billing-enrollment:${customer.organizationId}`,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const billing = yield* Billing.Service
    const enroll = yield* DurableRunner.supervised(EnrollRun, billing.ensureCustomer)
    return Service.of({
      enroll: Effect.fn("BillingEnrollment.enroll")(function* (customer) {
        yield* enroll(customer)
      }),
    })
  }),
)
