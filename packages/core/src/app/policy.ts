export * as AppPolicy from "./policy.js"

import { App } from "@ren/schema/app"
import { AppRelease } from "@ren/schema/app-release"
import { SpaceApp } from "@ren/schema/space-app"
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
      ...statements(Primitive.actions(App.definition, ["create"]), "app.targetMember"),
      ...statements(Primitive.actions(App.definition, ["update", "archive"]), "app.ownerMember"),
      ...statements(Primitive.actions(App.definition, ["transferOwnership"]), "app.ownerAndTargetMember"),
    ],
  },
  {
    primitive: AppRelease.definition.name,
    statements: [
      ...statements(Primitive.actions(AppRelease.definition, ["list", "get"]), "app.spaceMember"),
      ...statements(Primitive.actions(AppRelease.definition, ["create"]), "app.ownerMember"),
    ],
  },
  {
    primitive: SpaceApp.definition.name,
    statements: [...statements(Primitive.actions(SpaceApp.definition), "app.targetMember")],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export interface Holds {
  readonly isOwnerMember: boolean
  readonly isSpaceMember: boolean
  readonly isTargetMember?: boolean
}
export const resource = (holds: Holds): Access.Resource => ({
  relationships: [
    ...(holds.isOwnerMember ? ["app.ownerMember"] : []),
    ...(holds.isSpaceMember ? ["app.spaceMember"] : []),
    ...(holds.isTargetMember ? ["app.targetMember"] : []),
    ...(holds.isOwnerMember && holds.isTargetMember ? ["app.ownerAndTargetMember"] : []),
  ],
})
