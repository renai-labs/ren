export * as EnvironmentTemplatePolicy from "./policy.js"

import { Auth } from "@ren/schema/auth"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"

const readActions = Primitive.actions(EnvironmentTemplate.definition, ["list", "get"])

const writeActions = Primitive.actions(EnvironmentTemplate.definition, ["create", "update", "archive"])

export const documents = [
  {
    primitive: EnvironmentTemplate.definition.name,
    statements: [
      { actions: readActions, roles: Auth.Role.literals, on: Policy.everywhere },
      { actions: writeActions, roles: Auth.administratorRoles, on: Policy.everywhere },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
