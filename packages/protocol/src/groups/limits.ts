import { Limits } from "@ren/schema/limits"
import { Session } from "@ren/schema/session"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { NotFoundError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

export const LimitsGroup = HttpApiGroup.make("limits")
  .add(
    HttpApiEndpoint.get("limits.get", "/sessions/:id/limits", {
      params: { id: Session.ID },
      success: Limits.Info,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "limits.get",
        summary: "Read the limits of a chat’s model",
        description:
          "Return the meters of the chat’s current model: for a subscription, the windows of the seat that served the chat’s last seat call; for a Ren model, the organization’s credit; for a free Ren model, today’s free requests. Ren reads the model gateway and billing on each call. A member of the chat’s space reads it.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "internal")
