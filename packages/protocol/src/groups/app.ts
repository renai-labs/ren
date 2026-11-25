import { App } from "@ren/schema/app"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { NotFoundError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"
import { Primitive } from "../primitive.js"

export const AppGroup = Primitive.group(App.definition, "sdk", [
  Primitive.list(App.definition),
  Primitive.get(App.definition),
  Primitive.create(App.definition),
  Primitive.update(App.definition),
  Primitive.archive(App.definition),
  Primitive.action(App.definition, "transferOwnership"),
])

export const AppSkillsGroup = HttpApiGroup.make("app-skills")
  .add(
    HttpApiEndpoint.get("app-skills.get", "/apps/:idOrSlug/skills", {
      params: { idOrSlug: Schema.String },
      success: App.Skills,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "app-skills.get",
        summary: "Read an app’s skills",
        description:
          "Return each skill of the app with its instructions and files. app.get and app.list leave these out, since they can be large.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "app-skills" }))
