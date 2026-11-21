import { Billing } from "@ren/schema/billing"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { ConflictError, ForbiddenError, InvalidRequestError, NotFoundError, UnavailableError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

const errors = [ForbiddenError, InvalidRequestError, NotFoundError, ConflictError, UnavailableError]

export const BillingGroup = HttpApiGroup.make("billing")
  .add(
    HttpApiEndpoint.get("billing.get", "/billing", {
      success: Billing.Summary,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "billing.get",
        summary: "Get the organization’s plan and credit",
        description:
          "Return the plan, its status, the next billing date, a downgrade that waits, and the credit. An organization with no billing is on `free` with no credit.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("billing.plan.list", "/billing/plans", {
      success: Schema.Array(Billing.Plan),
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "billing.plan.list",
        summary: "List the paid plans",
        description: "Return the paid plans in display order. Free is not in the list.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("billing.invoice.list", "/billing/invoices", {
      query: Billing.InvoiceQuery,
      success: Billing.InvoicePage,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "billing.invoice.list",
        summary: "List the organization’s invoices",
        description: "Return a page of payments, newest first. Ask for `nextPage` until it is null.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("billing.invoice.url", "/billing/invoices/:id/url", {
      params: { id: Schema.String },
      success: Billing.Link,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "billing.invoice.url",
        summary: "Get an invoice’s link",
        description: "Return the address of one invoice of the organization. `url` is empty when it has none.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("billing.subscribe", "/billing/subscribe", {
      payload: Billing.PlanInput,
      success: Billing.Checkout,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "billing.subscribe",
        summary: "Start a subscription",
        description:
          "Return a checkout page for the plan. The plan changes after the payment. Only for an organization on Free. Admins and owners only.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("billing.change-plan", "/billing/change-plan", {
      payload: Billing.PlanInput,
      success: HttpApiSchema.NoContent,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "billing.change-plan",
        summary: "Change the plan",
        description:
          "Upgrade now, charged to the saved card, or downgrade on the next billing date. The plan changes when the payment clears. `409` means a payment is still processing. Admins and owners only.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("billing.cancel", "/billing/cancel", {
      success: HttpApiSchema.NoContent,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "billing.cancel",
        summary: "Cancel the plan",
        description: "End the plan on the next billing date. Then the organization is on Free. Admins and owners only.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("billing.portal", "/billing/portal", {
      success: Billing.Link,
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "billing.portal",
        summary: "Open the billing portal",
        description:
          "Return the address of the payment provider’s portal, to change the payment method. Admins and owners only.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "billing" }))
