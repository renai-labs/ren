import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { MembersSettingsPage } from "../../../../../features/members/members-page.js"

export const Route = createFileRoute("/_authed/_shell/settings/_admin/members")({
  head: () => ({ meta: [{ title: "Members · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({
      page: Schema.optional(Schema.Number),
      tab: Schema.optional(Schema.Literals(["members", "invitations"])),
    }),
  ),
  component: MembersSettingsPage,
})
