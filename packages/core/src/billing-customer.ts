export * as BillingCustomer from "./billing-customer.js"

import { Context, Effect, Layer } from "effect"
import { Billing } from "./billing.js"
import { DurableRunner } from "./durable-runner.js"

export interface Interface {
  readonly ensure: (customer: Billing.Customer) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/BillingCustomer") {}

// oxlint-disable-next-line ren/no-comments -- billing B15: one durable run per organization, so its billing customer is made even when billing is down when the organization is created. Until it succeeds the organization has no credit (billing E5).
const CreateCustomerRun = DurableRunner.make("BillingCustomer", {
  payload: Billing.Customer,
  idempotencyKey: (customer) => `billing-customer:${customer.organizationId}`,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const billing = yield* Billing.Service
    const create = yield* DurableRunner.supervised(CreateCustomerRun, billing.ensureCustomer)
    return Service.of({
      ensure: Effect.fn("BillingCustomer.ensure")(function* (customer) {
        yield* create(customer)
      }),
    })
  }),
)
