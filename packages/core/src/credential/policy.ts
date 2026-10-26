export * as CredentialPolicy from "./policy.js"

import { Credential } from "@ren/schema/credential"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import type { Access } from "../access.js"
import { SpacePolicy } from "../space/policy.js"

export const relationships = {
  org: "credential.org",
  space: "credential.space",
  spaceMember: "credential.spaceMember",
  person: "credential.person",
  self: "credential.self",
  profile: "credential.profile",
  accountHolder: "credential.accountHolder",
} as const

const read = Primitive.actions(Credential.definition, ["list", "get"])

const write = Primitive.actions(Credential.definition, ["create", "update", "rotate", "move", "copy", "remove"])

const remove = Primitive.actions(Credential.definition, ["remove"])

export const actions = {
  deliver: `${Credential.definition.name}.deliver`,
  moveAccount: `${Credential.definition.name}.moveAccount`,
} as const

const every = SpacePolicy.organizationRoles

const admins = SpacePolicy.administratorRoles

// oxlint-disable-next-line ren/no-comments -- owner-access §4. A profile's credentials follow who sees the profile (profiles.md §10), which `Credentials` checks before this statement applies. An admin sees a person's credential and may delete it, never use, move or copy it. Only admins choose delivered for an org credential. Only its holder moves an account credential (moveAccount, on top of move).
export const documents = [
  {
    primitive: Credential.definition.name,
    statements: [
      { actions: [...read, ...write], roles: every, on: relationships.org },
      { actions: [actions.deliver], roles: admins, on: relationships.org },
      { actions: [...read, ...write, actions.deliver], roles: admins, on: relationships.space },
      { actions: [...read, ...write, actions.deliver], roles: every, on: relationships.spaceMember },
      { actions: [...read, ...write, actions.deliver], roles: every, on: relationships.self },
      { actions: [...read, ...remove], roles: admins, on: relationships.person },
      { actions: [...read, ...write, actions.deliver], roles: every, on: relationships.profile },
      { actions: [actions.moveAccount], roles: every, on: relationships.accountHolder },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const resource = (
  owner: Credential.Owner,
  context: { readonly userId: string; readonly isSpaceMember: boolean },
): Access.Resource => {
  if (owner.kind === "org") return { relationships: [relationships.org] }
  if (owner.kind === "space")
    return {
      relationships: [relationships.space, ...(context.isSpaceMember ? [relationships.spaceMember] : [])],
      spaceId: owner.spaceId,
    }
  if (owner.kind === "profile") return { relationships: [relationships.profile] }
  return { relationships: [owner.userId === context.userId ? relationships.self : relationships.person] }
}

export const account = (holds: { readonly isHolder: boolean }): Access.Resource => ({
  relationships: holds.isHolder ? [relationships.accountHolder] : [],
})
