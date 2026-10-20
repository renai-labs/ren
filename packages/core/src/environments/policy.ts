export * as EnvironmentPolicy from "./policy.js"

import { Environment } from "@ren/schema/environment"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { SpacePolicy } from "../space/policy.js"

const readActions = Primitive.actions(Environment.definition, ["list", "get"])

const writeActions = Primitive.actions(Environment.definition, ["create", "update", "archive"])

export const documents = [
  {
    primitive: Environment.definition.name,
    statements: [
      { actions: readActions, roles: SpacePolicy.organizationRoles, on: Policy.everywhere },
      { actions: writeActions, roles: SpacePolicy.administratorRoles, on: Policy.everywhere },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
