import { Session } from "@ren/schema/session"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { NotFoundError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

export const ChatGroup = HttpApiGroup.make("chat")
  .add(
    HttpApiEndpoint.post("chat.access", "/sessions/:id/chat", {
      params: { id: Session.ID },
      success: Session.ClientAccess,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "chat.access",
        summary: "Open a session’s chat",
        description:
          "Return the URL of the session’s brain and a short-lived token for the Chat API. Ask again before `expiresAt`.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "chat" }))
