export * as EnvironmentPolicy from "./policy.js"

import { Environment } from "@ren/schema/environment"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { SpacePolicy } from "../space/policy.js"

const organizationActions = Primitive.actions(Environment.definition, ["list"])

const spaceActions = Primitive.actions(Environment.definition, ["get", "create", "update", "archive"])

export const documents = [
  {
    primitive: Environment.definition.name,
    statements: [
      { actions: organizationActions, roles: SpacePolicy.organizationRoles, on: Policy.everywhere },
      { actions: spaceActions, roles: SpacePolicy.administratorRoles, on: Policy.everywhere },
      { actions: spaceActions, roles: SpacePolicy.organizationRoles, on: SpacePolicy.memberOfSpace },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
