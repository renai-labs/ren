export * as Billing from "./billing.js"

import { Effect, Schema } from "effect"

const MicroUsd = Schema.Int.annotate({ description: "Millionths of a US dollar." })

const PlanKey = Schema.String.annotate({
  description: "A `key` from the plan list, or `free`.",
})

export interface Summary extends Schema.Schema.Type<typeof Summary> {}
export const Summary = Schema.Struct({
  plan: PlanKey,
  planStatus: Schema.NullOr(Schema.String).annotate({
    description: "The subscription’s status. `cancel_scheduled`: the plan ends on `renewsAt`.",
  }),
  renewsAt: Schema.NullOr(Schema.DateTimeUtc).annotate({
    description: "The next billing date. With `cancel_scheduled`, the plan ends then.",
  }),
  pendingPlan: Schema.NullOr(PlanKey).annotate({ description: "A downgrade that starts on `renewsAt`." }),
  availableMicroUsd: MicroUsd.annotate({ description: "The credit that new work can spend." }),
  grantedMicroUsd: MicroUsd.annotate({ description: "The credit the organization was given." }),
}).annotate({ identifier: "Billing.Summary", description: "The organization’s plan and credit." })

export interface Plan extends Schema.Schema.Type<typeof Plan> {}
export const Plan = Schema.Struct({
  key: PlanKey,
  name: Schema.String,
  priceCents: Schema.Int,
  creditsMicroUsd: MicroUsd.annotate({ description: "The credit of each monthly cycle." }),
  description: Schema.NullOr(Schema.String),
  tagline: Schema.NullOr(Schema.String),
  badge: Schema.NullOr(Schema.String),
  sortOrder: Schema.Number,
}).annotate({ identifier: "Billing.Plan", description: "A paid plan. Free is not in the list." })

export const InvoiceStatus = Schema.Literals(["paid", "pending", "processing", "failed", "cancelled"]).annotate({
  identifier: "Billing.InvoiceStatus",
})
export type InvoiceStatus = typeof InvoiceStatus.Type

export interface Invoice extends Schema.Schema.Type<typeof Invoice> {}
export const Invoice = Schema.Struct({
  id: Schema.String,
  number: Schema.String,
  status: InvoiceStatus,
  amountCents: Schema.Int.annotate({ description: "In the smallest unit of `currency`." }),
  currency: Schema.String,
  issuedAt: Schema.DateTimeUtc,
}).annotate({ identifier: "Billing.Invoice", description: "A payment of the organization." })

export interface InvoicePage extends Schema.Schema.Type<typeof InvoicePage> {}
export const InvoicePage = Schema.Struct({
  invoices: Schema.Array(Invoice),
  nextPage: Schema.NullOr(Schema.Int).annotate({ description: "Null when this page is the last." }),
}).annotate({ identifier: "Billing.InvoicePage" })

export interface InvoiceQuery extends Schema.Schema.Type<typeof InvoiceQuery> {}
export const InvoiceQuery = Schema.Struct({
  page: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(1))),
  perPage: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(10)),
  ),
}).annotate({ identifier: "Billing.InvoiceQuery" })

export interface PlanInput extends Schema.Schema.Type<typeof PlanInput> {}
export const PlanInput = Schema.Struct({ plan: PlanKey }).annotate({ identifier: "Billing.PlanInput" })

export interface Checkout extends Schema.Schema.Type<typeof Checkout> {}
export const Checkout = Schema.Struct({
  checkoutUrl: Schema.String.annotate({ description: "The payment page. Open it in a new tab." }),
}).annotate({ identifier: "Billing.Checkout" })

export interface Link extends Schema.Schema.Type<typeof Link> {}
export const Link = Schema.Struct({ url: Schema.String }).annotate({ identifier: "Billing.Link" })
