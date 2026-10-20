import { EnvironmentProvider } from "@ren/schema/environment-provider"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

export const EnvironmentProviderGroup = HttpApiGroup.make("environmentProvider")
  .add(
    HttpApiEndpoint.get("environmentProvider.list", "/environment-providers", {
      success: EnvironmentProvider.Infos,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "environmentProvider.list",
        summary: "List environment providers",
        description:
          "Return the environment providers this deployment has, each with a JSON Schema of the config that an environment template of that provider takes.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "environmentProvider" }))
