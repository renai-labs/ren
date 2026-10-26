export * as SchedulePolicy from "./policy.js"

import { Database } from "@ren/db/database"
import type { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { Schedule } from "@ren/schema/schedule"
import { ScheduleRun } from "@ren/schema/schedule-run"
import { isNotNull, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { Access } from "../access.js"
import { SpacePolicy } from "../space/policy.js"

export const facts = { spaceMember: "schedule.spaceMember" } as const

export const membership = alias(Database.Schema.space_member, "schedule_membership")

// oxlint-disable-next-line ren/no-comments -- schedules S9: every member of a schedule's space can do everything with it, as with chats (access §5).
export const documents = [
  {
    resource: Schedule.definition.name,
    rules: [
      {
        actions: Primitive.actions(Schedule.definition),
        effect: "allow",
        roles: SpacePolicy.organizationRoles,
        when: [facts.spaceMember],
      },
    ],
  },
  {
    resource: ScheduleRun.definition.name,
    rules: [
      {
        actions: Primitive.actions(ScheduleRun.definition),
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
