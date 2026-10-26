export * as CredentialPolicy from "./policy.js"

import { Credential } from "@ren/schema/credential"
import type { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import type { Access } from "../access.js"
import { SpacePolicy } from "../space/policy.js"

export const facts = {
  org: "credential.org",
  spaceMember: "credential.spaceMember",
  person: "credential.person",
  self: "credential.self",
  profile: "credential.profile",
  inProfile: "credential.inProfile",
  signIn: "credential.signIn",
  foreignAccount: "credential.foreignAccount",
  account: "credential.account",
  targetOrg: "target.org",
  targetOtherPerson: "target.otherPerson",
} as const

export const actions = {
  list: Primitive.action(Credential.definition, "list"),
  get: Primitive.action(Credential.definition, "get"),
  create: Primitive.action(Credential.definition, "create"),
  update: Primitive.action(Credential.definition, "update"),
  rotate: Primitive.action(Credential.definition, "rotate"),
  move: Primitive.action(Credential.definition, "move"),
  copy: Primitive.action(Credential.definition, "copy"),
  remove: Primitive.action(Credential.definition, "remove"),
  moveTo: `${Credential.definition.name}.moveTo`,
  deliver: `${Credential.definition.name}.deliver`,
  preview: `${Credential.definition.name}.preview`,
} as const

const read = [actions.list, actions.get]

const write = [actions.create, actions.update, actions.rotate, actions.move, actions.copy, actions.remove]

const every = SpacePolicy.organizationRoles

const admins = SpacePolicy.administratorRoles

// oxlint-disable-next-line ren/no-comments -- owner-access §4, access §10 (AC4, AC16), private-spaces PS4. Every member writes org credentials; space members write their space's; a person writes their own. An admin sees a person's credential without its preview and deletes it, never uses, moves or copies it. A profile's credentials follow who sees the profile. A profile's credential stays in its profile; only a pasted key is copied; only its holder moves an account credential, and never to the org or another person.
export const documents = [
  {
    resource: Credential.definition.name,
    rules: [
      { actions: [...read, ...write], effect: "allow", roles: every, when: [facts.org] },
      { actions: [...read, ...write], effect: "allow", roles: every, when: [facts.spaceMember] },
      { actions: [...read, ...write], effect: "allow", roles: every, when: [facts.self] },
      { actions: [...read, actions.remove], effect: "allow", roles: admins, when: [facts.person] },
      { actions: [...read, ...write], effect: "allow", roles: every, when: [facts.profile] },
      { actions: [actions.move, actions.copy], effect: "deny", roles: every, when: [facts.inProfile] },
      { actions: [actions.copy], effect: "deny", roles: every, when: [facts.signIn] },
      { actions: [actions.move], effect: "deny", roles: every, when: [facts.foreignAccount] },
      { actions: [actions.moveTo], effect: "allow", roles: every, when: [] },
      { actions: [actions.moveTo], effect: "deny", roles: every, when: [facts.account, facts.targetOrg] },
      { actions: [actions.moveTo], effect: "deny", roles: every, when: [facts.account, facts.targetOtherPerson] },
      { actions: [actions.deliver], effect: "allow", roles: admins, when: [facts.org] },
      { actions: [actions.deliver], effect: "allow", roles: every, when: [facts.spaceMember] },
      { actions: [actions.deliver], effect: "allow", roles: every, when: [facts.self] },
      { actions: [actions.preview], effect: "allow", roles: every, when: [facts.org] },
      { actions: [actions.preview], effect: "allow", roles: every, when: [facts.spaceMember] },
      { actions: [actions.preview], effect: "allow", roles: every, when: [facts.self] },
      { actions: [actions.preview], effect: "allow", roles: every, when: [facts.profile] },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export interface Context {
  readonly userId: string
  readonly isSpaceMember: boolean
  readonly isFenced: boolean
}

// oxlint-disable-next-line ren/no-comments -- The facts of an owner, as the target of a create, move or copy. A fenced agent (access AC18) does not count as the person.
export const resource = (owner: Credential.Owner, context: Context): Access.Resource => {
  if (owner.kind === "org") return { facts: [facts.org] }
  if (owner.kind === "space") return { facts: context.isSpaceMember ? [facts.spaceMember] : [] }
  if (owner.kind === "profile") return { facts: [facts.profile, facts.inProfile] }
  return { facts: owner.userId === context.userId && !context.isFenced ? [facts.self] : [facts.person] }
}

// oxlint-disable-next-line ren/no-comments -- A move names a credential and a target; the target adds its facts.
export const moveTo = (
  source: { readonly accountUserId: string | null },
  target: Credential.Owner,
  context: Context,
): Access.Resource => ({
  facts: [
    ...(source.accountUserId ? [facts.account] : []),
    ...(target.kind === "org" ? [facts.targetOrg] : []),
    ...(target.kind === "person" && target.userId !== context.userId ? [facts.targetOtherPerson] : []),
  ],
})
