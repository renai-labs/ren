import { Environment } from "@ren/schema/environment"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

export const HandProviderGroup = HttpApiGroup.make("handProvider")
  .add(
    HttpApiEndpoint.get("handProvider.list", "/hand-providers", {
      success: Environment.Providers,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "handProvider.list",
        summary: "List hand providers",
        description:
          "Return the hand providers this deployment has, each with a JSON Schema of the config that an environment of that provider takes.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "handProvider" }))
