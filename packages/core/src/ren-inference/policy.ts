export * as RenInferencePolicy from "./policy.js"

import { Auth } from "@ren/schema/auth"
import type { Policy } from "@ren/schema/policy"
import type { Access } from "../access.js"

const resource = "ren-inference"

export const actions = {
  connect: `${resource}.connect`,
  list: `${resource}.connection.list`,
  manage: `${resource}.connection.manage`,
} as const

const connector = `${resource}.connector`

// oxlint-disable-next-line ren/no-comments -- The Ren Inference Service knows no roles.
export const documents = [
  {
    resource,
    rules: [
      { actions: [actions.connect, actions.list], effect: "allow", roles: Auth.Role.literals, when: [] },
      { actions: [actions.manage], effect: "allow", roles: Auth.administratorRoles, when: [] },
      { actions: [actions.manage], effect: "allow", roles: Auth.Role.literals, when: [connector] },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const connection = (holds: { readonly isConnector: boolean }): Access.Resource => ({
  facts: holds.isConnector ? [connector] : [],
})
