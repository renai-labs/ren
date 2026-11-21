export * as SpacePolicy from "./policy.js"

import { Auth } from "@ren/schema/auth"
import type { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { Space } from "@ren/schema/space"
import { SpaceJoinRequest } from "@ren/schema/space-join-request"
import { SpaceMember } from "@ren/schema/space-member"
import type { Access } from "../access.js"

export const facts = {
  member: "space.member",
  shared: "space.shared",
  private: "space.private",
  owner: "space.owner",
  first: "space.first",
  requester: "space.requester",
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
  inviteLink: `${Space.definition.name}.invite-link`,
  reach: `${Space.definition.name}.reach`,
} as const

const member = Primitive.actions(SpaceMember.definition)

export const joinRequestActions = {
  create: Primitive.action(SpaceJoinRequest.definition, "create"),
  list: Primitive.action(SpaceJoinRequest.definition, "list"),
  listOwn: `${SpaceJoinRequest.definition.name}.listOwn`,
  approve: Primitive.action(SpaceJoinRequest.definition, "approve"),
  decline: Primitive.action(SpaceJoinRequest.definition, "decline"),
  cancel: Primitive.action(SpaceJoinRequest.definition, "cancel"),
} as const

// oxlint-disable-next-line ren/no-comments -- access §4: `get` is the list entry, `read` is what is inside.
export const documents = [
  {
    resource: Space.definition.name,
    rules: [
      { actions: [actions.list, actions.create], effect: "allow", roles: organizationRoles, when: [] },
      { actions: [actions.get], effect: "allow", roles: administratorRoles, when: [] },
      { actions: [actions.get], effect: "allow", roles: organizationRoles, when: [facts.shared] },
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
      { actions: [actions.inviteLink], effect: "allow", roles: organizationRoles, when: [facts.member, facts.shared] },
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
    resource: SpaceJoinRequest.definition.name,
    rules: [
      { actions: [joinRequestActions.create], effect: "allow", roles: organizationRoles, when: [facts.shared] },
      { actions: [joinRequestActions.create], effect: "deny", roles: organizationRoles, when: [facts.member] },
      {
        actions: [joinRequestActions.list, joinRequestActions.approve, joinRequestActions.decline],
        effect: "allow",
        roles: organizationRoles,
        when: [facts.member, facts.shared],
      },
      { actions: [joinRequestActions.listOwn], effect: "allow", roles: organizationRoles, when: [] },
      { actions: [joinRequestActions.cancel], effect: "allow", roles: organizationRoles, when: [facts.requester] },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const organization: Access.Resource = { facts: [] }

export interface Holds {
  readonly membershipId: Space.MembershipID | null
  readonly kind: Space.Kind
  readonly isOwner?: boolean
  readonly isFirst?: boolean
  readonly isRequester?: boolean
}

export const resource = (holds: Holds): Access.Resource => ({
  facts: [
    ...(holds.membershipId ? [facts.member] : []),
    holds.kind === "private" ? facts.private : facts.shared,
    ...(holds.isOwner ? [facts.owner] : []),
    ...(holds.isFirst ? [facts.first] : []),
    ...(holds.isRequester ? [facts.requester] : []),
  ],
})
