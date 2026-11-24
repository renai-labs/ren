export * as ViewPolicy from "./policy.js"

import type { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { View } from "@ren/schema/view"
import type { Access } from "../access.js"
import { SpacePolicy } from "../space/policy.js"

export const facts = {
  owner: "view.owner",
  shared: "view.shared",
  organization: "view.organization",
  space: "view.space",
  member: "view.member",
} as const

export const actions = {
  list: Primitive.action(View.definition, "list"),
  create: Primitive.action(View.definition, "create"),
  update: Primitive.action(View.definition, "update"),
  archive: Primitive.action(View.definition, "archive"),
}

const every = SpacePolicy.organizationRoles

const all = Primitive.actions(View.definition)

const manage = [actions.update, actions.archive]

// oxlint-disable-next-line ren/no-comments -- A person sees their own views and the shared views of the pages they see; admins also manage shared views.
export const documents = [
  {
    resource: View.definition.name,
    rules: [
      { actions: all, effect: "allow", roles: every, when: [facts.owner, facts.organization] },
      { actions: all, effect: "allow", roles: every, when: [facts.owner, facts.space, facts.member] },
      { actions: [actions.list], effect: "allow", roles: every, when: [facts.shared, facts.organization] },
      { actions: [actions.list], effect: "allow", roles: every, when: [facts.shared, facts.space, facts.member] },
      {
        actions: manage,
        effect: "allow",
        roles: SpacePolicy.administratorRoles,
        when: [facts.shared, facts.organization],
      },
      {
        actions: manage,
        effect: "allow",
        roles: SpacePolicy.administratorRoles,
        when: [facts.shared, facts.space, facts.member],
      },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const resource = (row: {
  readonly isOwner: boolean
  readonly shared: boolean
  readonly spaceId: string | null
  readonly isMember: boolean
}): Access.Resource => ({
  facts: [
    ...(row.isOwner ? [facts.owner] : []),
    ...(row.shared ? [facts.shared] : []),
    ...(row.spaceId ? [facts.space, ...(row.isMember ? [facts.member] : [])] : [facts.organization]),
  ],
})
