export * as BillingPolicy from "./policy.js"

import type { Policy } from "@ren/schema/policy"
import { SpacePolicy } from "../space/policy.js"

const resource = "billing"

export const actions = {
  get: `${resource}.get`,
  planList: `${resource}.plan.list`,
  invoiceList: `${resource}.invoice.list`,
  invoiceUrl: `${resource}.invoice.url`,
  subscribe: `${resource}.subscribe`,
  changePlan: `${resource}.change-plan`,
  cancel: `${resource}.cancel`,
  portal: `${resource}.portal`,
} as const

// oxlint-disable-next-line ren/no-comments -- Every member reads the plan and invoices; admins and owners change the plan and pay.
export const documents = [
  {
    resource,
    rules: [
      {
        actions: [actions.get, actions.planList, actions.invoiceList, actions.invoiceUrl],
        effect: "allow",
        roles: SpacePolicy.organizationRoles,
        when: [],
      },
      {
        actions: [actions.subscribe, actions.changePlan, actions.cancel, actions.portal],
        effect: "allow",
        roles: SpacePolicy.administratorRoles,
        when: [],
      },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
