import { Form } from "@ren/schema/form"
import { Permission } from "@ren/schema/permission"
import { Session } from "@ren/schema/session"
import { SessionEvent } from "@ren/schema/session-event"
import { SessionInbox } from "@ren/schema/session-inbox"
import { SessionInfo } from "@ren/schema/session-info"
import { SessionMessage } from "@ren/schema/session-message"
import { SessionModel } from "@ren/schema/session-model"
import { SessionStatus } from "@ren/schema/session-status"
import { Shell } from "@ren/schema/shell"
import { Schema, SchemaGetter } from "effect"
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

export interface CompactInput extends Schema.Schema.Type<typeof CompactInput> {}
export const CompactInput = Schema.Struct({ id: SessionMessage.ID }).annotate({ identifier: "Chat.CompactInput" })

export interface RenameInput extends Schema.Schema.Type<typeof RenameInput> {}
export const RenameInput = Schema.Struct({ title: Schema.Trimmed.check(Schema.isNonEmpty()) }).annotate({
  identifier: "Chat.RenameInput",
})

export interface RevertInput extends Schema.Schema.Type<typeof RevertInput> {}
export const RevertInput = Schema.Struct({ messageID: SessionMessage.ID }).annotate({ identifier: "Chat.RevertInput" })

export const MessagesQuery = Schema.Struct({
  limit: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 200 }))),
  cursor: Schema.optional(Schema.String),
}).annotate({ identifier: "Chat.MessagesQuery" })

export const InterruptQuery = Schema.Struct({
  resume: Schema.optional(
    Schema.Literals(["true", "false"]).pipe(
      Schema.decodeTo(Schema.Boolean, {
        decode: SchemaGetter.transform((value) => value === "true"),
        encode: SchemaGetter.transform((value): "true" | "false" => (value ? "true" : "false")),
      }),
    ),
  ),
}).annotate({ identifier: "Chat.InterruptQuery" })

export const ShellOutputQuery = Schema.Struct({
  cursor: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  limit: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0))),
}).annotate({ identifier: "Chat.ShellOutputQuery" })

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
    HttpApiEndpoint.post("session.compact", "/chat/session/:sessionID/compact", {
      params,
      payload: CompactInput,
      success: SessionInbox.Compaction,
      error: [NotFoundError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.compact",
        summary: "Compact the session",
        description:
          "Summarize the history so later turns send the summary instead of the older messages. The session merges a compaction that is already pending, so the answer may carry another `id` than the one sent.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("session.interrupt", "/chat/session/:sessionID/interrupt", {
      params,
      query: InterruptQuery,
      success: HttpApiSchema.NoContent,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.interrupt",
        summary: "Stop the turn",
        description:
          "Stop the running turn of the session or of a subagent session. With `resume=true` the session goes on with the steered input that waits, while queued input stays queued.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("session.background", "/chat/session/:sessionID/background", {
      params,
      success: HttpApiSchema.NoContent,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.background",
        summary: "Move work to the background",
        description:
          "Let the running shell commands and subagents of the turn go on in the background, so the turn can end. An idle session is left alone.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("session.rename", "/chat/session/:sessionID", {
      params,
      payload: RenameInput,
      success: HttpApiSchema.NoContent,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.rename",
        summary: "Rename the session",
        description: "Change the title of the session. Ren receives the new title with the next sync.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("session.revert.stage", "/chat/session/:sessionID/revert", {
      params,
      payload: RevertInput,
      success: SessionInfo.Revert,
      error: [NotFoundError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.revert.stage",
        summary: "Undo up to a message",
        description:
          "Stop the running turn, wait for it to end, then hide the message and everything after it, and undo their file changes. `session.revert.clear` brings them back; `session.revert.commit` drops them.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("session.revert.clear", "/chat/session/:sessionID/revert", {
      params,
      success: HttpApiSchema.NoContent,
      error: [NotFoundError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.revert.clear",
        summary: "Redo",
        description: "Bring back every message the staged revert hides, with their file changes.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("session.revert.commit", "/chat/session/:sessionID/revert/commit", {
      params,
      success: HttpApiSchema.NoContent,
      error: [NotFoundError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.revert.commit",
        summary: "Drop the reverted messages",
        description:
          "Delete the messages the staged revert hides, and the input queued after them. Send it before the next prompt.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("session.inbox.cancel", "/chat/session/:sessionID/inbox/:inboxID", {
      params: { ...params, inboxID: SessionMessage.ID },
      success: HttpApiSchema.NoContent,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.inbox.cancel",
        summary: "Withdraw pending input",
        description: "Withdraw input the session has not taken yet. Input it already took is left alone.",
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

export const ShellGroup = HttpApiGroup.make("shell")
  .add(
    HttpApiEndpoint.get("shell.list", "/chat/session/:sessionID/shell", {
      params,
      success: Schema.Array(Shell.Info),
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "shell.list",
        summary: "List running shell commands",
        description:
          "Return the shell commands that still run where the session works, each with the session that started it. Commands that ended are left out.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("shell.output", "/chat/session/:sessionID/shell/:shellID/output", {
      params: { ...params, shellID: Shell.ID },
      query: ShellOutputQuery,
      success: Shell.Output,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "shell.output",
        summary: "Read shell output",
        description:
          "Return the output of a shell command that runs where the session works, from a byte `cursor` on. Read again from the returned `cursor` while it is below `size` or the command runs. A command the session no longer keeps is not found.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("shell.remove", "/chat/session/:sessionID/shell/:shellID", {
      params: { ...params, shellID: Shell.ID },
      success: HttpApiSchema.NoContent,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "shell.remove",
        summary: "Stop a shell command",
        description:
          "Stop a shell command that runs where the session works, and drop its output. A command that is already gone is left alone.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "shell" }))

export const ChatApi = HttpApi.make("chat")
  .add(EventGroup)
  .add(ModelGroup)
  .add(SessionGroup)
  .add(ShellGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren Chat API",
      version: "0.0.0",
      description: "The API a client uses to follow and drive one live session, served by the session’s brain.",
    }),
  )
