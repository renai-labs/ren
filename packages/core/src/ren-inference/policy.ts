export * as RenInferencePolicy from "./policy.js"

import { Auth } from "@ren/schema/auth"
import { Policy } from "@ren/schema/policy"
import type { Access } from "../access.js"

const primitive = "ren-inference"

export const actions = {
  connect: `${primitive}.connect`,
  list: `${primitive}.connection.list`,
  manage: `${primitive}.connection.manage`,
} as const

const connector = `${primitive}.connector`

// oxlint-disable-next-line ren/no-comments -- Any member connects a model provider and sees the organization's connections; the member who connected one and admins rename, reconnect and remove it. The Ren Inference Service knows no roles.
export const documents = [
  {
    primitive,
    statements: [
      { actions: [actions.connect, actions.list], roles: Auth.Role.literals, on: Policy.everywhere },
      { actions: [actions.manage], roles: Auth.administratorRoles, on: Policy.everywhere },
      { actions: [actions.manage], roles: Auth.Role.literals, on: connector },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const connection = (holds: { readonly isConnector: boolean }): Access.Resource => ({
  relationships: holds.isConnector ? [connector] : [],
})
