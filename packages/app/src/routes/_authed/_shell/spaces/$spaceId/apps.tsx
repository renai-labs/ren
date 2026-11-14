import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { SpaceAppsTab } from "../../../../../features/spaces/space-apps.js"

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId/apps")({
  head: () => ({ meta: [{ title: "Apps · Space · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ app: Schema.optional(Schema.String), show: Schema.optional(Schema.Literals(["custom"])) }),
  ),
  wrapInSuspense: false,
  component: SpaceAppsTab,
})
