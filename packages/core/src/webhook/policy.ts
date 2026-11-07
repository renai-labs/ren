export * as WebhookPolicy from "./policy.js"

import { Database } from "@ren/db/database"
import type { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { Webhook } from "@ren/schema/webhook"
import { WebhookRequest } from "@ren/schema/webhook-request"
import { isNotNull, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { Access } from "../access.js"
import { SpacePolicy } from "../space/policy.js"

export const facts = { spaceMember: "webhook.spaceMember" } as const

export const membership = alias(Database.Schema.space_member, "webhook_membership")

export const documents = [
  {
    resource: Webhook.definition.name,
    rules: [
      {
        actions: Primitive.actions(Webhook.definition),
        effect: "allow",
        roles: SpacePolicy.organizationRoles,
        when: [facts.spaceMember],
      },
    ],
  },
  {
    resource: WebhookRequest.definition.name,
    rules: [
      {
        actions: Primitive.actions(WebhookRequest.definition),
        effect: "allow",
        roles: SpacePolicy.organizationRoles,
        when: [facts.spaceMember],
      },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const resource = (membershipId: string | null): Access.Resource => ({
  facts: membershipId ? [facts.spaceMember] : [],
})

export const where: ReadonlyMap<string, SQL> = new Map([[facts.spaceMember, isNotNull(membership.id)]])
