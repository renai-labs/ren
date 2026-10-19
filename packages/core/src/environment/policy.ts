export * as EnvironmentPolicy from "./policy.js"

import { Environment } from "@ren/schema/environment"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { SpaceEnvironment } from "@ren/schema/space-environment"
import { SpacePolicy } from "../space/policy.js"

const readActions = Primitive.actions(Environment.definition, ["list", "get"])

const writeActions = Primitive.actions(Environment.definition, ["create", "update", "archive"])

const linkActions = Primitive.actions(SpaceEnvironment.definition)

export const documents = [
  {
    primitive: Environment.definition.name,
    statements: [
      { actions: readActions, roles: SpacePolicy.organizationRoles, on: Policy.everywhere },
      { actions: writeActions, roles: SpacePolicy.administratorRoles, on: Policy.everywhere },
    ],
  },
  {
    primitive: SpaceEnvironment.definition.name,
    statements: [
      { actions: linkActions, roles: SpacePolicy.administratorRoles, on: Policy.everywhere },
      { actions: linkActions, roles: SpacePolicy.organizationRoles, on: SpacePolicy.memberOfSpace },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
