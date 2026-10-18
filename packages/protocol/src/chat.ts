import { Form } from "@ren/schema/form"
import { Permission } from "@ren/schema/permission"
import { Session } from "@ren/schema/session"
import { SessionEvent } from "@ren/schema/session-event"
import { SessionInbox } from "@ren/schema/session-inbox"
import { SessionInfo } from "@ren/schema/session-info"
import { SessionMessage } from "@ren/schema/session-message"
import { SessionModel } from "@ren/schema/session-model"
import { SessionStatus } from "@ren/schema/session-status"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { ConflictError, ForbiddenError, InvalidRequestError, NotFoundError } from "./errors.js"

const params = { sessionID: Session.ID }

export interface PromptInput extends Schema.Schema.Type<typeof PromptInput> {}
export const PromptInput = Schema.Struct({
  id: SessionMessage.ID,
  text: Schema.NonEmptyString,
  delivery: SessionInbox.Delivery,
}).annotate({ identifier: "Chat.PromptInput" })

export interface Accepted extends Schema.Schema.Type<typeof Accepted> {}
export const Accepted = Schema.Struct({ id: SessionMessage.ID }).annotate({ identifier: "Chat.Accepted" })

export const MessagesQuery = Schema.Struct({
  limit: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 200 }))),
  cursor: Schema.optional(Schema.String),
}).annotate({ identifier: "Chat.MessagesQuery" })

export const EventGroup = HttpApiGroup.make("event")
  .add(
    HttpApiEndpoint.get("event.subscribe", "/chat/event", {
      success: HttpApiSchema.StreamSse({ data: SessionEvent.Frame }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "event.subscribe",
        summary: "Follow a session",
        description:
          "Stream the events of the session and its subagent sessions. The first frame is `server.connected`; `server.heartbeat` follows every 15 seconds. The stream ends with `stream.ended` once the session has been idle for a while. Events missed while disconnected are not replayed: read the resources again after `server.connected`.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "event" }))

export const ModelGroup = HttpApiGroup.make("model")
  .add(
    HttpApiEndpoint.get("model.list", "/chat/model", {
      success: Schema.Array(SessionModel.Info),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "model.list",
        summary: "List models",
        description: "List the models this session may switch to, with their variants.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "model" }))

export const SessionGroup = HttpApiGroup.make("session")
  .add(
    HttpApiEndpoint.get("session.get", "/chat/session/:sessionID", {
      params,
      success: SessionInfo.Info,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.get",
        summary: "Get a session",
        description: "Return the title, usage, revert boundary and capabilities of the session or a subagent session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("session.status", "/chat/status", {
      success: SessionStatus.Family,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.status",
        summary: "Get the status of the session family",
        description: "Return the sessions of the family that are running. A session that is absent is idle.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("session.messages", "/chat/session/:sessionID/message", {
      params,
      query: MessagesQuery,
      success: SessionMessage.Page,
      error: [NotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.messages",
        summary: "List messages",
        description: "Return a page of messages, newest first. Follow `cursor.next` for older messages.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("session.message", "/chat/session/:sessionID/message/:messageID", {
      params: { ...params, messageID: SessionMessage.ID },
      success: SessionMessage.Info,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.message",
        summary: "Get a message",
        description: "Return one message of the session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("session.children", "/chat/session/:sessionID/children", {
      params,
      success: Schema.Array(SessionInfo.Info),
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.children",
        summary: "List subagent sessions",
        description: "Return the subagent sessions the session started.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("session.inbox.list", "/chat/session/:sessionID/inbox", {
      params,
      success: Schema.Array(SessionInbox.Info),
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.inbox.list",
        summary: "List pending input",
        description: "Return the messages that wait for the session to take them, steered or queued.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("session.permission.list", "/chat/session/:sessionID/permission", {
      params,
      success: Schema.Array(Permission.Request),
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.permission.list",
        summary: "List permission requests",
        description: "Return the permission requests that wait for an answer.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("session.form.list", "/chat/session/:sessionID/form", {
      params,
      success: Schema.Array(Form.Info),
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.form.list",
        summary: "List questions",
        description: "Return the questions that wait for an answer.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("session.prompt", "/chat/session/:sessionID/prompt", {
      params,
      payload: PromptInput,
      success: Accepted,
      error: [NotFoundError, ForbiddenError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.prompt",
        summary: "Send a message",
        description:
          "Send a message to the session. `steer` reaches the running turn; `queue` waits for the turn to end. Sending the same `id` again returns the same answer and sends nothing new.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("session.interrupt", "/chat/session/:sessionID/interrupt", {
      params,
      success: HttpApiSchema.NoContent,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.interrupt",
        summary: "Stop the turn",
        description: "Stop the running turn of the session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("session.model.switch", "/chat/session/:sessionID/model", {
      params,
      payload: Schema.Struct({ model: SessionModel.Ref }),
      success: HttpApiSchema.NoContent,
      error: [NotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.model.switch",
        summary: "Switch the model",
        description: "Use another model or variant from the next step on. The model must be in `model.list`.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("session.permission.reply", "/chat/session/:sessionID/permission/:requestID/reply", {
      params: { ...params, requestID: Permission.RequestID },
      payload: Schema.Struct({ reply: Permission.Reply }),
      success: HttpApiSchema.NoContent,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.permission.reply",
        summary: "Answer a permission request",
        description: "Allow the request once, allow it always, or reject it.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("session.form.reply", "/chat/session/:sessionID/form/:formID/reply", {
      params: { ...params, formID: Form.ID },
      payload: Form.Reply,
      success: HttpApiSchema.NoContent,
      error: [NotFoundError, ConflictError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.form.reply",
        summary: "Answer a question",
        description: "Answer a question the session asked.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("session.form.cancel", "/chat/session/:sessionID/form/:formID", {
      params: { ...params, formID: Form.ID },
      success: HttpApiSchema.NoContent,
      error: [NotFoundError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.form.cancel",
        summary: "Dismiss a question",
        description: "Dismiss a question without an answer.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "session" }))

export const ChatApi = HttpApi.make("chat")
  .add(EventGroup)
  .add(ModelGroup)
  .add(SessionGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren Chat API",
      version: "0.0.0",
      description: "The API a client uses to follow and drive one live session, served by the session’s brain.",
    }),
  )
