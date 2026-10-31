import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { CredentialsSettingsPage } from "../../../../features/credentials/credentials-page.js"

export const Route = createFileRoute("/_authed/_shell/settings/credentials")({
  head: () => ({ meta: [{ title: "Credentials · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({
      page: Schema.optional(Schema.Number),
      tab: Schema.optional(Schema.Literals(["apps", "keys"])),
      app: Schema.optional(Schema.String),
    }),
  ),
  component: CredentialsSettingsPage,
})
