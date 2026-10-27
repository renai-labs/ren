export * as AppPolicy from "./policy.js"

import { App } from "@ren/schema/app"
import { AppRegistry } from "@ren/schema/app-registry"
import type { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import type { Access } from "../access.js"
import { SpacePolicy } from "../space/policy.js"

export const facts = {
  ownerMember: "app.ownerMember",
  spaceMember: "app.spaceMember",
  listed: "app.listed",
  targetMember: "app.targetMember",
} as const

const every = SpacePolicy.organizationRoles

// oxlint-disable-next-line ren/no-comments -- access §8: org apps belong to their owner space; registry apps are read-only.
export const documents = [
  {
    resource: App.definition.name,
    rules: [
      {
        actions: Primitive.actions(App.definition, ["list", "get"]),
        effect: "allow",
        roles: every,
        when: [facts.spaceMember],
      },
      {
        actions: Primitive.actions(App.definition, ["list", "get"]),
        effect: "allow",
        roles: every,
        when: [facts.listed],
      },
      {
        actions: Primitive.actions(App.definition, ["create"]),
        effect: "allow",
        roles: every,
        when: [facts.targetMember],
      },
      {
        actions: Primitive.actions(App.definition, ["update", "archive"]),
        effect: "allow",
        roles: every,
        when: [facts.ownerMember],
      },
      {
        actions: Primitive.actions(App.definition, ["transferOwnership"]),
        effect: "allow",
        roles: every,
        when: [facts.ownerMember, facts.targetMember],
      },
    ],
  },
  {
    resource: AppRegistry.definition.name,
    rules: [{ actions: Primitive.actions(AppRegistry.definition), effect: "allow", roles: every, when: [] }],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export interface Holds {
  readonly isOwnerMember: boolean
  readonly isSpaceMember: boolean
  readonly isTargetMember?: boolean
  readonly isListed?: boolean
}

export const resource = (holds: Holds): Access.Resource => ({
  facts: [
    ...(holds.isOwnerMember ? [facts.ownerMember] : []),
    ...(holds.isSpaceMember ? [facts.spaceMember] : []),
    ...(holds.isListed ? [facts.listed] : []),
    ...(holds.isTargetMember ? [facts.targetMember] : []),
  ],
})
