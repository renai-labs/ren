import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { AppPage } from "../../../../../features/apps/app-page.js"

export const Route = createFileRoute("/_authed/_shell/apps/$appId/")({
  head: () => ({ meta: [{ title: "Apps · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ account: Schema.optional(Schema.String), space: Schema.optional(Schema.String) }),
  ),
  component: AppPage,
})
