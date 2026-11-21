import { AppListing } from "@ren/schema/app-listing"
import { AppRegistry } from "@ren/schema/app-registry"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { NotFoundError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"
import { Primitive } from "../primitive.js"

export const AppRegistryGroup = Primitive.group(AppRegistry.definition, "sdk", [
  Primitive.list(AppRegistry.definition),
  Primitive.get(AppRegistry.definition),
])

export const AppToolsGroup = HttpApiGroup.make("app-tools")
  .add(
    HttpApiEndpoint.get("app-tools.get", "/app-registry/:idOrSlug/tools", {
      params: { idOrSlug: Schema.String },
      success: AppListing.Tools,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "app-tools.get",
        summary: "List a registry app’s tools",
        description: "Return the tools each MCP of a registry app offers, by MCP slug, as its listing records them.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "app-tools" }))
