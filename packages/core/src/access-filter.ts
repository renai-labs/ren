export * as AccessFilter from "./access-filter.js"

import { or, sql, type SQL } from "drizzle-orm"
import type { Access } from "./access.js"

// oxlint-disable-next-line ren/no-comments -- A plan as a SQL filter, as a Cerbos query plan adapter.
export const where = (plan: Access.Plan, conditions: ReadonlyMap<string, SQL | undefined>) =>
  plan.isAllowedEverywhere
    ? undefined
    : (or(...plan.allowedWhere.map((relationship) => conditions.get(relationship))) ?? sql`false`)
