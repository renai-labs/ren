import type { App } from "@ren/schema/app"
import type { AppListing } from "@ren/schema/app-listing"
import { defineRelationsPart, sql } from "drizzle-orm"
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"
import { app } from "./app.sql.js"

export const app_listing = pgTable("app_listing", {
  app_id: text()
    .$type<App.ID>()
    .primaryKey()
    .references(() => app.id),
  body: text(),
  categories: jsonb().$type<AppListing.Info["categories"]>().default({}).notNull(),
  example_prompts: text()
    .array()
    .default(sql`'{}'::text[]`)
    .notNull(),
  created_at: timestamp().defaultNow().notNull(),
  updated_at: timestamp().defaultNow().notNull(),
  archived_at: timestamp(),
})

export const appListingRelations = defineRelationsPart({ app_listing, app }, (r) => ({
  app_listing: {
    app: r.one.app({ from: r.app_listing.app_id, to: r.app.id }),
  },
}))
