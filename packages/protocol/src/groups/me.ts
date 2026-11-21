import { Auth } from "@ren/schema/auth"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { ConflictError, UnauthorizedError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { Mcp } from "../mcp.js"
import { Authentication } from "../middleware/authentication.js"

export const MeGroup = HttpApiGroup.make("me")
  .add(
    HttpApiEndpoint.get("me.get", "/me", {
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
  .add(
    HttpApiEndpoint.post("me.requestDeletion", "/me/deletion", {
      success: HttpApiSchema.NoContent,
      error: [UnauthorizedError, ConflictError],
    })
      .annotate(Mcp.Hidden, "An agent must not delete the account of the person it acts for.")
      .annotateMerge(
        OpenApi.annotations({
          identifier: "me.requestDeletion",
          summary: "Request deletion of the signed-in account",
          description:
            "Archive the signed-in user’s account, sign them out everywhere and email them that Ren received the request. The account cannot sign in again, and Ren deletes its data within 7 days. Asking again sends no second email. Fails with a conflict while the user is the only owner of an organization that has other members.",
        }),
      ),
  )
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "me" }))
