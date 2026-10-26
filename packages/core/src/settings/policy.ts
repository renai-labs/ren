export * as SettingsPolicy from "./policy.js"

import { Auth } from "@ren/schema/auth"
import { OrganizationSettings } from "@ren/schema/organization-settings"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { SpaceSettings } from "@ren/schema/space-settings"
import type { Access } from "../access.js"
import { SpacePolicy } from "../space/policy.js"

const spaceMember = SpacePolicy.member

export const documents = [
  {
    primitive: OrganizationSettings.definition.name,
    statements: [
      {
        actions: Primitive.actions(OrganizationSettings.definition, ["get"]),
        roles: Auth.Role.literals,
        on: Policy.everywhere,
      },
      {
        actions: Primitive.actions(OrganizationSettings.definition, ["update"]),
        roles: Auth.administratorRoles,
        on: Policy.everywhere,
      },
    ],
  },
  {
    primitive: SpaceSettings.definition.name,
    statements: [
      { actions: Primitive.actions(SpaceSettings.definition), roles: Auth.administratorRoles, on: Policy.everywhere },
      { actions: Primitive.actions(SpaceSettings.definition), roles: Auth.Role.literals, on: spaceMember },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const space = (isMember: boolean): Access.Resource => ({ relationships: isMember ? [spaceMember] : [] })
