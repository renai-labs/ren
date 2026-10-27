export * as OAuthAppPolicy from "./policy.js"

import { OAuthApp } from "@ren/schema/oauth-app"
import type { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { SpacePolicy } from "../space/policy.js"

// oxlint-disable-next-line ren/no-comments -- access §10 (AC16): OAuth apps are for every member.
export const documents = [
  {
    resource: OAuthApp.definition.name,
    rules: [
      {
        actions: Primitive.actions(OAuthApp.definition),
        effect: "allow",
        roles: SpacePolicy.organizationRoles,
        when: [],
      },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
