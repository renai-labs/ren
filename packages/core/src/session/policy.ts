export * as SessionPolicy from "./policy.js"

import type { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { Session } from "@ren/schema/session"
import { Auth } from "@ren/schema/auth"
import type { Access } from "../access.js"

export const facts = { spaceMember: "session.spaceMember" } as const

export const actions = {
  list: Primitive.action(Session.definition, "list"),
  get: Primitive.action(Session.definition, "get"),
  create: Primitive.action(Session.definition, "create"),
  archive: Primitive.action(Session.definition, "archive"),
  retry: `${Session.definition.name}.retry`,
  access: `${Session.definition.name}.access`,
  send: `${Session.definition.name}.send`,
} as const

// oxlint-disable-next-line ren/no-comments -- access §5: a chat belongs to its space and its members.
export const documents = [
  {
    resource: Session.definition.name,
    rules: [
      {
        actions: Object.values(actions),
        effect: "allow",
        roles: Auth.Role.literals,
        when: [facts.spaceMember],
      },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const resource = (membershipId: string | null): Access.Resource => ({
  facts: membershipId ? [facts.spaceMember] : [],
})
