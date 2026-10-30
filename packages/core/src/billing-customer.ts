export * as BillingCustomer from "./billing-customer.js"

import { Auth } from "@ren/schema/auth"
import { Context, Effect, Layer, Schema } from "effect"
import { WorkflowEngine } from "effect/workflow"
import { Billing } from "./billing.js"
import { DurableRunner } from "./durable-runner.js"

export interface Interface {
  readonly ensure: (input: {
    readonly organizationId: Auth.OrganizationID
    readonly name: string
    readonly ownerEmail: string
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/BillingCustomer") {}

// oxlint-disable-next-line ren/no-comments -- billing B15: one durable run per organization, so its billing customer is made even when billing is down when the organization is created. Until it succeeds the organization has no credit (billing E5).
const EnsureRun = DurableRunner.make("BillingCustomer", {
  payload: { organizationId: Auth.OrganizationID, name: Schema.String, ownerEmail: Schema.String },
  idempotencyKey: (payload) => `billing-customer:${payload.organizationId}`,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const billing = yield* Billing.Service
    const engine = yield* WorkflowEngine.WorkflowEngine
    yield* DurableRunner.register(EnsureRun, (payload) =>
      DurableRunner.supervise(
        `billing-customer:${payload.organizationId}`,
        billing.ensureCustomer(payload.organizationId, { name: payload.name, ownerEmail: payload.ownerEmail }),
      ),
    )
    return Service.of({
      ensure: Effect.fn("BillingCustomer.ensure")(function* (input) {
        yield* DurableRunner.ensure(EnsureRun, input).pipe(Effect.provideService(WorkflowEngine.WorkflowEngine, engine))
      }),
    })
  }),
)
