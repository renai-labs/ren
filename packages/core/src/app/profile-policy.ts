export * as AppProfilePolicy from "./profile-policy.js"

import { AppProfile } from "@ren/schema/app-profile"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import type { Access } from "../access.js"
import { SpacePolicy } from "../space/policy.js"

export const relationships = {
  shared: "profile.shared",
  creator: "profile.creator",
  listedMember: "profile.listedMember",
  allSpaces: "profile.allSpaces",
  private: "profile.private",
  self: "profile.self",
} as const

export const actions = {
  list: Primitive.action(AppProfile.definition, "list"),
  get: Primitive.action(AppProfile.definition, "get"),
  create: Primitive.action(AppProfile.definition, "create"),
  update: Primitive.action(AppProfile.definition, "update"),
  access: Primitive.action(AppProfile.definition, "access"),
  link: Primitive.action(AppProfile.definition, "link"),
  promote: Primitive.action(AppProfile.definition, "promote"),
  connect: `${AppProfile.definition.name}.connect`,
  delete: `${AppProfile.definition.name}.delete`,
} as const

const every = SpacePolicy.organizationRoles

const admins = SpacePolicy.administratorRoles

const see = [actions.list, actions.get, actions.connect, actions.delete]

// oxlint-disable-next-line ren/no-comments -- profiles.md §10. Anyone who sees a shared profile connects its items and deletes it (P27, P28); its creator and admins rename it, link it and edit its list, each list write only for spaces they belong to (checked in AppProfiles, P19). An admin sees a private profile's metadata and may delete it, never use it (P5).
export const documents = [
  {
    primitive: AppProfile.definition.name,
    statements: [
      { actions: [actions.create], roles: every, on: Policy.everywhere },
      { actions: [...see, actions.update, actions.link, actions.access], roles: admins, on: relationships.shared },
      { actions: see, roles: every, on: relationships.listedMember },
      { actions: see, roles: every, on: relationships.allSpaces },
      { actions: [...see, actions.update, actions.link, actions.access], roles: every, on: relationships.creator },
      {
        actions: [...see, actions.update, actions.link, actions.promote],
        roles: every,
        on: relationships.self,
      },
      { actions: [actions.list, actions.get, actions.delete], roles: admins, on: relationships.private },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export interface Holds {
  readonly kind: AppProfile.Kind
  readonly isCreator: boolean
  readonly isListedMember: boolean
  readonly allSpaces: boolean
  readonly isSelf: boolean
}

export const resource = (holds: Holds): Access.Resource => ({
  relationships:
    holds.kind === "shared"
      ? [
          relationships.shared,
          ...(holds.isCreator ? [relationships.creator] : []),
          ...(holds.isListedMember ? [relationships.listedMember] : []),
          ...(holds.allSpaces ? [relationships.allSpaces] : []),
        ]
      : [relationships.private, ...(holds.isSelf ? [relationships.self] : [])],
})
