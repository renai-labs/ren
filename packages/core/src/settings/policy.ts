export * as SettingsPolicy from "./policy.js"

import { OrganizationSettings } from "@ren/schema/organization-settings"
import type { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { SpaceSettings } from "@ren/schema/space-settings"
import type { Access } from "../access.js"
import { SpacePolicy } from "../space/policy.js"

const facts = { spaceMember: "space.member" } as const

// oxlint-disable-next-line ren/no-comments -- access §3, §11: org settings for admins, space settings for members.
export const documents = [
  {
    resource: OrganizationSettings.definition.name,
    rules: [
      {
        actions: Primitive.actions(OrganizationSettings.definition, ["get"]),
        effect: "allow",
        roles: SpacePolicy.organizationRoles,
        when: [],
      },
      {
        actions: Primitive.actions(OrganizationSettings.definition, ["update"]),
        effect: "allow",
        roles: SpacePolicy.administratorRoles,
        when: [],
      },
    ],
  },
  {
    resource: SpaceSettings.definition.name,
    rules: [
      {
        actions: Primitive.actions(SpaceSettings.definition),
        effect: "allow",
        roles: SpacePolicy.organizationRoles,
        when: [facts.spaceMember],
      },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const organization: Access.Resource = { facts: [] }

export const space = (isMember: boolean): Access.Resource => ({ facts: isMember ? [facts.spaceMember] : [] })
