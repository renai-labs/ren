export * as ArtifactPolicy from "./policy.js"

import { Database } from "@ren/db/database"
import { Artifact } from "@ren/schema/artifact"
import type { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { isNotNull, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { Access } from "../access.js"
import { SpacePolicy } from "../space/policy.js"

export const facts = { spaceMember: "artifact.spaceMember" } as const

export const membership = alias(Database.Schema.space_member, "artifact_membership")

export const documents = [
  {
    resource: Artifact.definition.name,
    rules: [
      {
        actions: Primitive.actions(Artifact.definition),
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
