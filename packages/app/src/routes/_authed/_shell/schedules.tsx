import { createFileRoute, redirect } from "@tanstack/react-router"
import { Schema } from "effect"

const Search = Schema.toStandardSchemaV1(Schema.Struct({ schedule: Schema.optional(Schema.String) }))

export const Route = createFileRoute("/_authed/_shell/schedules")({
  head: () => ({ meta: [{ title: "Automations · Ren" }] }),
  validateSearch: Search,
  beforeLoad: (options) => {
    throw redirect({
      to: "/automations",
      search: options.search.schedule ? { schedule: options.search.schedule } : {},
      replace: true,
    })
  },
})
