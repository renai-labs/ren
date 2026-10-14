export * as OrganizationAccess from "./organization-access.js"

import { Auth } from "@ren/schema/auth"
import { createAccessControl } from "better-auth/plugins/access"

const statement = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
} as const

export const control = createAccessControl(statement)

export const roles = {
  owner: control.newRole(statement),
  admin: control.newRole({ ...statement, organization: ["update"] }),
  member: control.newRole({ organization: [], member: [], invitation: [] }),
} satisfies Record<Auth.Role, unknown>
