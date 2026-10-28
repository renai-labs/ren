export * as Billing from "./billing.js"

import type { Auth } from "@ren/schema/auth"
import { Context, Effect, Layer, Schema } from "effect"

export class Refused extends Schema.TaggedError<Refused>()("Billing.Refused", {
  reason: Schema.Literals(["insufficient_credits", "budget_unreadable"]),
}) {}

export const messages: Record<Refused["reason"], string> = {
  insufficient_credits: "The organization has no credits left.",
  budget_unreadable: "Ren cannot read the organization’s credits now. Try again in a few minutes.",
}

export interface Interface {
  readonly check: (organizationId: Auth.OrganizationID) => Effect.Effect<void, Refused>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Billing") {}

export const layerNone = Layer.succeed(
  Service,
  Service.of({
    check: Effect.fn("Billing.check")(function* () {}),
  }),
)
