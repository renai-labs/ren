import { Session } from "@ren/schema/session"
import { SessionModel } from "@ren/schema/session-model"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ConflictError, NotFoundError } from "../errors.js"
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
  .add(
    HttpApiEndpoint.post("chat.fork", "/sessions/:sessionId/fork", {
      params: { sessionId: Session.ID },
      payload: Session.ForkInput,
      success: Session.Info,
      error: [NotFoundError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "chat.fork",
        summary: "Fork a session",
        description:
          "Start a new session in the same space from the session’s messages before `messageId`. The new session links to its source in `forkedFrom`. Retrying with the same `id` returns the fork.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "chat" }))
