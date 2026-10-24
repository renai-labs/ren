export * as OAuthAppPolicy from "./policy.js"

import { OAuthApp } from "@ren/schema/oauth-app"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { SpacePolicy } from "../space/policy.js"

// oxlint-disable-next-line ren/no-comments -- owner-access §13: the OAuth apps page is open to every member; an org app is the org's, like an org credential.
export const documents = [
  {
    primitive: OAuthApp.definition.name,
    statements: [
      { actions: Primitive.actions(OAuthApp.definition), roles: SpacePolicy.organizationRoles, on: Policy.everywhere },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
