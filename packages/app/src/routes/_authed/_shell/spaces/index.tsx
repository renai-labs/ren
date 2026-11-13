import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { SpacesPage } from "../../../../features/spaces/spaces-page.js"
import { Loader } from "../../../../lib/loader.js"
import { Pages } from "../../../../lib/pages.js"

export const Route = createFileRoute("/_authed/_shell/spaces/")({
  head: () => ({ meta: [{ title: "Spaces · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ tab: Schema.optional(Schema.Literals(["your", "all"])) })),
  loader: (options) => {
    Loader.start(options.context.queryClient.infiniteQuery(Pages.spaces(options.context.client)))
  },
  component: SpacesPage,
})
