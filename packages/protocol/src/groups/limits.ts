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
          "Return what the chat’s current model uses up: the limits its model gateway reports (the free cap of a free model; the windows of the seat that served the chat’s last seat call) and, for a model Ren pays for, the organization’s Ren credit. Ren reads the gateway and billing on each call. A member of the chat’s space reads it.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "internal")
