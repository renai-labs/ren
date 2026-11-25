export * as ProviderPolicy from "./policy.js"

import { Auth } from "@ren/schema/auth"
import type { Policy } from "@ren/schema/policy"

const resource = "provider"

export const actions = {
  view: `${resource}.view`,
  manage: `${resource}.manage`,
} as const

// oxlint-disable-next-line ren/no-comments -- Providers P7: every member sees the Providers page; admins and owners change providers, methods, keys and model switches. Seats keep their own rules (ren-inference.connection.manage).
export const documents = [
  {
    resource,
    rules: [
      { actions: [actions.view], effect: "allow", roles: Auth.Role.literals, when: [] },
      { actions: [actions.manage], effect: "allow", roles: Auth.administratorRoles, when: [] },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
