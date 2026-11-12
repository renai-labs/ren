import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { BillingPage } from "../../../../../features/billing/billing-page.js"
import { Loader } from "../../../../../lib/loader.js"

export const Route = createFileRoute("/_authed/_shell/settings/_admin/billing")({
  head: () => ({ meta: [{ title: "Billing & plans · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({
      tab: Schema.optional(Schema.Literals(["billing", "plans"])),
    }),
  ),
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query(options.context.api.billing.get.queryOptions()),
      options.context.queryClient.query(options.context.api.billing.plan.list.queryOptions()),
    )
  },
  component: BillingPage,
})
