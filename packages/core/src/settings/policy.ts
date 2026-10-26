export * as SettingsPolicy from "./policy.js"

import { Auth } from "@ren/schema/auth"
import { OrganizationSettings } from "@ren/schema/organization-settings"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { SpaceSettings } from "@ren/schema/space-settings"
import type { Access } from "../access.js"
import { SpacePolicy } from "../space/policy.js"

const spaceMember = SpacePolicy.member

const organizationRoles = Auth.Role.literals

const administratorRoles = ["owner", "admin"] as const satisfies ReadonlyArray<Auth.Role>

export const documents = [
  {
    primitive: OrganizationSettings.definition.name,
    statements: [
      {
        actions: Primitive.actions(OrganizationSettings.definition, ["get"]),
        roles: organizationRoles,
        on: Policy.everywhere,
      },
      {
        actions: Primitive.actions(OrganizationSettings.definition, ["update"]),
        roles: administratorRoles,
        on: Policy.everywhere,
      },
    ],
  },
  {
    primitive: SpaceSettings.definition.name,
    statements: [
      { actions: Primitive.actions(SpaceSettings.definition), roles: administratorRoles, on: Policy.everywhere },
      { actions: Primitive.actions(SpaceSettings.definition), roles: organizationRoles, on: spaceMember },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const organization: Access.Resource = { relationships: [] }

export const space = (isMember: boolean): Access.Resource => ({ relationships: isMember ? [spaceMember] : [] })
