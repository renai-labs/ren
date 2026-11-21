export * as InsightsPolicy from "./policy.js"

import type { Policy } from "@ren/schema/policy"
import { SpacePolicy } from "../space/policy.js"

const resource = "insights"

export const actions = {
  organization: `${resource}.organization`,
} as const

// oxlint-disable-next-line ren/no-comments -- A space's usage follows `space.read`; the whole organization's is for admins and owners.
export const documents = [
  {
    resource,
    rules: [{ actions: [actions.organization], effect: "allow", roles: SpacePolicy.administratorRoles, when: [] }],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
