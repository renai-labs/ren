export * as EnvironmentTemplatePolicy from "./policy.js"

import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { SpacePolicy } from "../space/policy.js"

const readActions = Primitive.actions(EnvironmentTemplate.definition, ["list", "get"])

const writeActions = Primitive.actions(EnvironmentTemplate.definition, ["create", "update", "archive"])

export const documents = [
  {
    primitive: EnvironmentTemplate.definition.name,
    statements: [
      { actions: readActions, roles: SpacePolicy.organizationRoles, on: Policy.everywhere },
      { actions: writeActions, roles: SpacePolicy.administratorRoles, on: Policy.everywhere },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
