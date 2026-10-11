import { Auth } from "@ren/schema/auth"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { UnauthorizedError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { Authentication } from "../middleware/authentication.js"

export const MeGroup = HttpApiGroup.make("me")
  .add(
    HttpApiEndpoint.get("me.get", "/api/me", {
      success: Auth.Me,
      error: UnauthorizedError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "me.get",
        summary: "Get the signed-in user",
        description:
          "Return the signed-in user and their active organization, or `null` if they have none yet (for example, while an invitation is pending).",
      }),
    ),
  )
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "me" }))
