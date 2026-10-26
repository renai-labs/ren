export * as AccessFilter from "./access-filter.js"

import { or, sql, type SQL } from "drizzle-orm"
import type { Access } from "./access.js"

// oxlint-disable-next-line ren/no-comments -- A plan as a SQL filter, as Cerbos's query plan adapters: no filter when a statement on all applies, else any relationship the plan allows, each by its condition.
export const where = (plan: Access.Plan, conditions: ReadonlyMap<string, SQL | undefined>) =>
  plan.isAllowedEverywhere
    ? undefined
    : (or(...plan.allowedWhere.map((relationship) => conditions.get(relationship))) ?? sql`false`)
