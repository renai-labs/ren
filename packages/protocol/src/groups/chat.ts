import { Session } from "@ren/schema/session"
import { SessionModel } from "@ren/schema/session/model"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
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
  .add(
    HttpApiEndpoint.post("chat.retry", "/sessions/:id/chat/retry", {
      params: { id: Session.ID },
      payload: Schema.Struct({ message: Schema.optional(Session.FirstMessage) }),
      success: HttpApiSchema.NoContent,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "chat.retry",
        summary: "Retry a failed session",
        description:
          "Start the session’s brain again after `chat.access` returned `failed`, and start the session with `message` as its first message. A session that already started ignores `message`.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("chat.models", "/sessions/:id/models", {
      params: { id: Session.ID },
      success: Schema.Array(SessionModel.Choice),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "chat.models",
        summary: "List models for a new session",
        description:
          "Return the models and variants a session with this ID may start with, before it exists. Pass one as `model` to `session.create`. Once the session runs, `model.list` in the Chat API lists them.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "chat" }))
