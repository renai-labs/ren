export * as EnvironmentTemplatePolicy from "./policy.js"

import { EnvironmentTemplate } from "@ren/schema/environment-template"
import type { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { SpacePolicy } from "../space/policy.js"

// oxlint-disable-next-line ren/no-comments -- access §11: every member reads the org's environment templates; admins write them.
export const documents = [
  {
    resource: EnvironmentTemplate.definition.name,
    rules: [
      {
        actions: Primitive.actions(EnvironmentTemplate.definition, ["list", "get"]),
        effect: "allow",
        roles: SpacePolicy.organizationRoles,
        when: [],
      },
      {
        actions: Primitive.actions(EnvironmentTemplate.definition, ["create", "update", "archive"]),
        effect: "allow",
        roles: SpacePolicy.administratorRoles,
        when: [],
      },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
