export * as MachineTemplatePolicy from "./policy.js"

import { MachineTemplate } from "@ren/schema/machine-template"
import type { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { SpacePolicy } from "../space/policy.js"

// oxlint-disable-next-line ren/no-comments -- access §11: admins write environment templates.
export const documents = [
  {
    resource: MachineTemplate.definition.name,
    rules: [
      {
        actions: Primitive.actions(MachineTemplate.definition, ["list", "get"]),
        effect: "allow",
        roles: SpacePolicy.organizationRoles,
        when: [],
      },
      {
        actions: Primitive.actions(MachineTemplate.definition, [
          "create",
          "update",
          "archive",
          "retryBuild",
          "affectedSpaces",
        ]),
        effect: "allow",
        roles: SpacePolicy.administratorRoles,
        when: [],
      },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
