export * as SpacePolicy from "./policy.js"

import { Auth } from "@ren/schema/auth"
import type { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { Space } from "@ren/schema/space"
import { SpaceEnvironmentTemplate } from "@ren/schema/space-environment-template"
import { SpaceMember } from "@ren/schema/space-member"
import type { Access } from "../access.js"

export const facts = {
  member: "space.member",
  shared: "space.shared",
  private: "space.private",
  owner: "space.owner",
  first: "space.first",
} as const

export const administratorRoles = ["owner", "admin"] as const satisfies ReadonlyArray<Auth.Role>

export const organizationRoles = Auth.Role.literals

export const actions = {
  list: Primitive.action(Space.definition, "list"),
  get: Primitive.action(Space.definition, "get"),
  read: `${Space.definition.name}.read`,
  create: Primitive.action(Space.definition, "create"),
  update: Primitive.action(Space.definition, "update"),
  archive: Primitive.action(Space.definition, "archive"),
  join: `${Space.definition.name}.join`,
  reach: `${Space.definition.name}.reach`,
} as const

const member = Primitive.actions(SpaceMember.definition)

// oxlint-disable-next-line ren/no-comments -- access §4 (AC3-AC5), private-spaces rules 5-8. `get` is the list entry; `read` is what is inside. An admin sees every list entry, reads a shared space's description, joins a shared space and archives another person's private space.
export const documents = [
  {
    resource: Space.definition.name,
    rules: [
      { actions: [actions.list, actions.create], effect: "allow", roles: organizationRoles, when: [] },
      { actions: [actions.get], effect: "allow", roles: administratorRoles, when: [] },
      {
        actions: [actions.get, actions.read, actions.update],
        effect: "allow",
        roles: organizationRoles,
        when: [facts.member],
      },
      { actions: [actions.read, actions.reach], effect: "allow", roles: administratorRoles, when: [facts.shared] },
      { actions: [actions.reach], effect: "allow", roles: organizationRoles, when: [facts.member] },
      { actions: [actions.archive], effect: "allow", roles: organizationRoles, when: [facts.member, facts.shared] },
      { actions: [actions.archive], effect: "allow", roles: administratorRoles, when: [facts.private] },
      { actions: [actions.archive], effect: "deny", roles: organizationRoles, when: [facts.first] },
      { actions: [actions.archive], effect: "deny", roles: organizationRoles, when: [facts.owner] },
      { actions: [actions.join], effect: "allow", roles: administratorRoles, when: [facts.shared] },
      { actions: [actions.join], effect: "deny", roles: organizationRoles, when: [facts.member] },
    ],
  },
  {
    resource: SpaceMember.definition.name,
    rules: [
      { actions: member, effect: "allow", roles: organizationRoles, when: [facts.member] },
      {
        actions: Primitive.actions(SpaceMember.definition, ["list"]),
        effect: "allow",
        roles: administratorRoles,
        when: [facts.shared],
      },
      {
        actions: Primitive.actions(SpaceMember.definition, ["create", "archive"]),
        effect: "deny",
        roles: organizationRoles,
        when: [facts.private],
      },
    ],
  },
  {
    resource: SpaceEnvironmentTemplate.definition.name,
    rules: [
      {
        actions: Primitive.actions(SpaceEnvironmentTemplate.definition),
        effect: "allow",
        roles: organizationRoles,
        when: [facts.member],
      },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const organization: Access.Resource = { facts: [] }

export interface Holds {
  readonly membershipId: Space.MembershipID | null
  readonly kind: Space.Kind
  readonly isOwner?: boolean
  readonly isFirst?: boolean
}

export const resource = (holds: Holds): Access.Resource => ({
  facts: [
    ...(holds.membershipId ? [facts.member] : []),
    holds.kind === "private" ? facts.private : facts.shared,
    ...(holds.isOwner ? [facts.owner] : []),
    ...(holds.isFirst ? [facts.first] : []),
  ],
})
