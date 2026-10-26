export * as OAuthAppPolicy from "./policy.js"

import { Auth } from "@ren/schema/auth"
import { OAuthApp } from "@ren/schema/oauth-app"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"

// oxlint-disable-next-line ren/no-comments -- owner-access §13: the OAuth apps page is open to every member; an org app is the org's, like an org credential.
export const documents = [
  {
    primitive: OAuthApp.definition.name,
    statements: [{ actions: Primitive.actions(OAuthApp.definition), roles: Auth.Role.literals, on: Policy.everywhere }],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
