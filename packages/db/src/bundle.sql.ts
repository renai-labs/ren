import type { Bundle } from "@ren/schema/bundle"
import { pgTable, text, timestamp } from "drizzle-orm/pg-core"

// oxlint-disable-next-line ren/no-comments -- EN29: the current bundle of each kind. A server moves it only to a later build, so two servers during a deploy never move a machine back.
export const bundle = pgTable("bundle", {
  kind: text().$type<Bundle.Kind>().primaryKey(),
  version: text().notNull(),
  sha256: text().notNull(),
  built_at: timestamp().notNull(),
})
