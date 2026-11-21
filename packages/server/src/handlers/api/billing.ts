import { Access } from "@ren/core/access"
import { Billing } from "@ren/core/billing"
import { BillingPolicy } from "@ren/core/billing/policy"
import { ForbiddenError, UnavailableError } from "@ren/protocol/errors"
import type { Auth } from "@ren/schema/auth"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

const retryAfterMs = 5000

export const BillingHandler = HttpApiBuilder.group(Api, "billing", (handlers) =>
  Effect.gen(function* () {
    const billing = yield* Billing.Service
    const access = yield* Access.Service

    // oxlint-disable-next-line ren/no-comments -- The role check is here, so it holds with and without a billing service.
    const allowed = <A>(
      action: string,
      method: (organizationId: Auth.OrganizationID) => Effect.Effect<A, Billing.Failure>,
    ) =>
      Effect.gen(function* () {
        const actor = yield* Primitive.currentActor
        if (!access.isAllowed({ actor, action, resource: Access.organization }))
          return yield* new ForbiddenError({ message: "Only admins and owners can change billing." })
        return yield* method(actor.organizationId)
      }).pipe(
        Effect.catchTags({
          "Primitive.Invalid": Primitive.invalid,
          "Primitive.Conflict": Primitive.conflict,
          "Primitive.NotFound": Primitive.notFound,
          "Billing.Unavailable": (error) => Effect.fail(new UnavailableError({ message: error.message, retryAfterMs })),
        }),
      )

    return handlers
      .handle("billing.get", () => allowed(BillingPolicy.actions.get, billing.summary))
      .handle("billing.plan.list", () => allowed(BillingPolicy.actions.planList, billing.plans))
      .handle("billing.invoice.list", (request) =>
        allowed(BillingPolicy.actions.invoiceList, (organizationId) => billing.invoices(organizationId, request.query)),
      )
      .handle("billing.invoice.url", (request) =>
        allowed(BillingPolicy.actions.invoiceUrl, (organizationId) =>
          billing.invoiceUrl(organizationId, request.params.id),
        ),
      )
      .handle("billing.subscribe", (request) =>
        allowed(BillingPolicy.actions.subscribe, (organizationId) =>
          billing.subscribe(organizationId, request.payload),
        ),
      )
      .handle("billing.change-plan", (request) =>
        allowed(BillingPolicy.actions.changePlan, (organizationId) =>
          billing.changePlan(organizationId, request.payload),
        ),
      )
      .handle("billing.cancel", () => allowed(BillingPolicy.actions.cancel, billing.cancel))
      .handle("billing.portal", () => allowed(BillingPolicy.actions.portal, billing.portal))
  }),
)
