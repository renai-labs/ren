export * as AppPolicy from "./policy.js"

import { App } from "@ren/schema/app"
import { AppRegistry } from "@ren/schema/app-registry"
import { Auth } from "@ren/schema/auth"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import type { Access } from "../access.js"

const statements = (actions: ReadonlyArray<string>, on: string) => [
  { actions, roles: ["owner", "admin"] as const, on: Policy.everywhere },
  { actions, roles: Auth.Role.literals, on },
]

export const documents = [
  {
    primitive: App.definition.name,
    statements: [
      ...statements(Primitive.actions(App.definition, ["list", "get"]), "app.spaceMember"),
      { actions: Primitive.actions(App.definition, ["list", "get"]), roles: Auth.Role.literals, on: "app.listed" },
      ...statements(Primitive.actions(App.definition, ["create"]), "app.targetMember"),
      ...statements(Primitive.actions(App.definition, ["update", "archive"]), "app.ownerMember"),
      ...statements(Primitive.actions(App.definition, ["transferOwnership"]), "app.ownerAndTargetMember"),
    ],
  },
  {
    primitive: AppRegistry.definition.name,
    statements: [
      { actions: Primitive.actions(AppRegistry.definition), roles: Auth.Role.literals, on: Policy.everywhere },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export interface Holds {
  readonly organizationId: Auth.OrganizationID | null
  readonly isOwnerMember: boolean
  readonly isSpaceMember: boolean
  readonly isTargetMember?: boolean
  readonly isListed?: boolean
}
export const resource = (holds: Holds): Access.Resource => ({
  organizationId: holds.organizationId,
  relationships: [
    ...(holds.isOwnerMember ? ["app.ownerMember"] : []),
    ...(holds.isSpaceMember ? ["app.spaceMember"] : []),
    ...(holds.isListed ? ["app.listed"] : []),
    ...(holds.isTargetMember ? ["app.targetMember"] : []),
    ...(holds.isOwnerMember && holds.isTargetMember ? ["app.ownerAndTargetMember"] : []),
  ],
})
