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

// oxlint-disable-next-line ren/no-comments -- access §5 (AC4, AC6, AC7): a chat belongs to its space. Every space member reads, joins, sends a turn to and archives every chat of the space; an admin joins the space first.
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
