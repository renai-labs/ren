import { Form } from "@ren/schema/form"
import { Permission } from "@ren/schema/permission"
import { Session } from "@ren/schema/session"
import { SessionCatalog } from "@ren/schema/session/catalog"
import { SessionEvent } from "@ren/schema/session/event"
import { SessionInbox } from "@ren/schema/session/inbox"
import { SessionInfo } from "@ren/schema/session/info"
import { SessionMessage } from "@ren/schema/session/message"
import { SessionModel } from "@ren/schema/session/model"
import { SessionStatus } from "@ren/schema/session/status"
import { SessionVcs } from "@ren/schema/session/vcs"
import { Shell } from "@ren/schema/shell"
import { Schema, SchemaGetter } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/http-api"
import { ConflictError, ForbiddenError, InvalidRequestError, NotFoundError, UnavailableError } from "./errors.js"

const params = { sessionID: Session.ID }

export class ChatAccess extends HttpApiMiddleware.Service<ChatAccess>()("@ren/protocol/chat/ChatAccess", {
  error: [ForbiddenError, UnavailableError],
}) {}

export interface PromptSkill extends Schema.Schema.Type<typeof PromptSkill> {}
export const PromptSkill = Schema.Struct({
  id: Schema.String,
  mention: Schema.optionalKey(SessionMessage.Mention),
}).annotate({ identifier: "Chat.PromptSkill" })

const mentions = {
  agents: Schema.optional(Schema.Array(SessionMessage.AgentAttachment)).annotate({
    description: "Subagents the text mentions, from `agent.list`.",
  }),
  skills: Schema.optional(Schema.Array(PromptSkill)).annotate({
    description: "Skills the text mentions, from `skill.list`.",
  }),
}

export interface PromptInput extends Schema.Schema.Type<typeof PromptInput> {}
export const PromptInput = Schema.Struct({
  id: SessionMessage.ID,
  text: Schema.NonEmptyString,
  delivery: SessionInbox.Delivery,
  resume: Schema.optional(Schema.Boolean).annotate({
    description:
      "With `false`, the message waits in the inbox and does not start a turn on an idle session, so a client can put queued messages back in another order. Defaults to `true`.",
  }),
  files: Schema.optional(Session.DriveFiles).annotate({
    description:
      "Files that the message attaches, uploaded to the space’s drive with `drive.startUpload`. A file that is not in the drive is refused.",
  }),
  ...mentions,
}).annotate({ identifier: "Chat.PromptInput" })

export interface CommandInput extends Schema.Schema.Type<typeof CommandInput> {}
export const CommandInput = Schema.Struct({
  name: Schema.NonEmptyString,
  text: Schema.String.annotate({ description: "The arguments after the command name." }),
  delivery: SessionInbox.Delivery,
  ...mentions,
}).annotate({ identifier: "Chat.CommandInput" })

export interface PermissionReplyInput extends Schema.Schema.Type<typeof PermissionReplyInput> {}
export const PermissionReplyInput = Schema.Struct({
  reply: Permission.Reply,
  message: Schema.optional(Schema.Trimmed.check(Schema.isNonEmpty())).annotate({
    description: "With `reject`, what the session should do instead. The session reads it and goes on.",
  }),
}).annotate({ identifier: "Chat.PermissionReplyInput" })

export interface InboxUpdateInput extends Schema.Schema.Type<typeof InboxUpdateInput> {}
export const InboxUpdateInput = Schema.Struct({ delivery: SessionInbox.Delivery }).annotate({
  identifier: "Chat.InboxUpdateInput",
})

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

export const FileSearchQuery = Schema.Struct({
  query: Schema.String,
  type: Schema.optional(SessionCatalog.FileType),
  limit: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 200 }))),
}).annotate({ identifier: "Chat.FileSearchQuery" })

const FolderPath = Schema.String.check(
  Schema.makeFilter(
    (path) =>
      (!path.startsWith("/") && !path.split("/").includes("..")) ||
      "A path relative to the session’s folder, without `..`",
  ),
).annotate({ description: "A path relative to the session’s folder. A folder may end with `/`." })

export const FileListQuery = Schema.Struct({
  path: Schema.optional(FolderPath).annotate({ description: "The folder to list. Defaults to the session’s folder." }),
}).annotate({ identifier: "Chat.FileListQuery" })

export const FileReadQuery = Schema.Struct({ path: FolderPath }).annotate({ identifier: "Chat.FileReadQuery" })

export const VcsDiffQuery = Schema.Struct({
  mode: Schema.optional(SessionVcs.Mode).annotate({
    description:
      "`working` compares HEAD with the working copy, `branch` the branch’s base with the working copy, and `committed` the base with HEAD. Defaults to `working`.",
  }),
  context: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))).annotate({
    description: "Unchanged lines around each hunk. Omit for full-file patches.",
  }),
}).annotate({ identifier: "Chat.VcsDiffQuery" })

export interface ShellCreateInput extends Schema.Schema.Type<typeof ShellCreateInput> {}
export const ShellCreateInput = Schema.Struct({
  command: Schema.Trimmed.check(Schema.isNonEmpty()).annotate({ description: "Runs in the session’s folder." }),
  timeout: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))).annotate({
    description: "Milliseconds after which the command is stopped. Without it, the command runs until it ends.",
  }),
}).annotate({ identifier: "Chat.ShellCreateInput" })

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
      error: [NotFoundError, ConflictError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.prompt",
        summary: "Send a message",
        description:
          "Send a message to the session. `steer` reaches the running turn; `queue` waits for the turn to end. Sending the same `id` again returns the same answer and sends nothing new. When another member spoke last, the session is told who sends the message.",
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
      error: [NotFoundError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.inbox.cancel",
        summary: "Withdraw pending input",
        description:
          "Withdraw input the session has not taken yet. Input the session took before the withdrawal is left alone and answers a conflict, so the client keeps its message.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("session.inbox.update", "/chat/session/:sessionID/inbox/:inboxID", {
      params: { ...params, inboxID: SessionMessage.ID },
      payload: InboxUpdateInput,
      success: HttpApiSchema.NoContent,
      error: [NotFoundError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.inbox.update",
        summary: "Steer or queue pending input",
        description:
          "Change how pending input reaches the session: `steer` sends it into the running turn, or starts a turn when the session is idle; `queue` holds it until the turn ends. Input the session already took answers a conflict. The order of queued input does not change.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("session.command", "/chat/session/:sessionID/command", {
      params,
      payload: CommandInput,
      success: HttpApiSchema.NoContent,
      error: [NotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.command",
        summary: "Run a command",
        description:
          "Run a command from `command.list` with its arguments. The command sends its prompt to the session like `session.prompt`, under an ID the session picks. A command the session does not know is not found; a command that fails is an invalid request.",
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
        description:
          "Set the session’s model and variant from the next step on. It is the session’s own setting: it wins over the model its settings give and outlasts a restart. The model must be in `model.list`. A subagent session cannot switch.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("session.permission.reply", "/chat/session/:sessionID/permission/:requestID/reply", {
      params: { ...params, requestID: Permission.RequestID },
      payload: PermissionReplyInput,
      success: HttpApiSchema.NoContent,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.permission.reply",
        summary: "Answer a permission request",
        description:
          "Allow the request once, allow it always, or reject it. A rejection with a `message` tells the session what to do instead.",
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
  .middleware(ChatAccess)
  .add(
    HttpApiEndpoint.get("session.status", "/chat/status", {
      success: SessionStatus.Family,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.status",
        summary: "Get the status of the session family",
        description:
          "Return the sessions of the family that are running. A session that is absent is idle. A retry shows on the running assistant message as `retry`, not here.",
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
    HttpApiEndpoint.post("shell.create", "/chat/session/:sessionID/shell", {
      params,
      payload: ShellCreateInput,
      success: Shell.Info,
      error: [NotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "shell.create",
        summary: "Run a shell command",
        description:
          "Run a command in the session’s environment, without a terminal or input, and return it at once while it runs. Follow it with `shell.output`, and the `shell.created` and `shell.exited` events. A session without an environment refuses it.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("shell.get", "/chat/session/:sessionID/shell/:shellID", {
      params: { ...params, shellID: Shell.ID },
      success: Shell.Info,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "shell.get",
        summary: "Read a shell command",
        description:
          "Return a shell command that runs or ran where the session works, with its status and exit code. A command the session no longer keeps is not found.",
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
  .middleware(ChatAccess)
  .annotateMerge(OpenApi.annotations({ title: "shell" }))

const catalog = <const Name extends "agent" | "skill" | "command", S extends Schema.Top>(
  name: Name,
  item: S,
  summary: string,
  description: string,
) =>
  HttpApiGroup.make(name)
    .add(
      HttpApiEndpoint.get(`${name}.list`, `/chat/session/:sessionID/${name}`, {
        params,
        success: Schema.Array(item),
        error: NotFoundError,
      }).annotateMerge(OpenApi.annotations({ identifier: `${name}.list`, summary, description })),
    )
    .middleware(ChatAccess)
    .annotateMerge(OpenApi.annotations({ title: name }))

export const AgentGroup = catalog(
  "agent",
  SessionCatalog.Agent,
  "List agents",
  "Return the agents where the session works. A composer offers the ones that are not hidden and not `primary` as `@` mentions.",
)

export const SkillGroup = catalog(
  "skill",
  SessionCatalog.Skill,
  "List skills",
  "Return the skills where the session works, for `@` mentions.",
)

export const CommandGroup = catalog(
  "command",
  SessionCatalog.Command,
  "List commands",
  "Return the commands where the session works, for `/` in the composer. `session.command` runs one.",
)

export const FileGroup = HttpApiGroup.make("file")
  .add(
    HttpApiEndpoint.get("file.search", "/chat/session/:sessionID/file", {
      params,
      query: FileSearchQuery,
      success: Schema.Array(SessionCatalog.File),
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "file.search",
        summary: "Search files",
        description:
          "Return files and folders where the session works whose path matches `query`, best match first, for `@` mentions. Paths are relative to the session’s folder; a folder ends with `/`.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("file.list", "/chat/session/:sessionID/file/list", {
      params,
      query: FileListQuery,
      success: Schema.Array(SessionCatalog.File),
      error: [NotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "file.list",
        summary: "List a folder",
        description:
          "Return the files and folders directly in a folder of the session’s environment, folders first. Paths are relative to the session’s folder; a folder ends with `/`. A folder that is missing is not found, and a session without an environment refuses it.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("file.read", "/chat/session/:sessionID/file/read", {
      params,
      query: FileReadQuery,
      success: SessionCatalog.FileContent,
      error: [NotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "file.read",
        summary: "Read a file",
        description:
          "Return a file of the session’s environment: text as `utf8`, anything else as `base64`. A large file returns its start, with `truncated` set. A file that is missing is not found, and a session without an environment refuses it.",
      }),
    ),
  )
  .middleware(ChatAccess)
  .annotateMerge(OpenApi.annotations({ title: "file" }))

export const VcsGroup = HttpApiGroup.make("vcs")
  .add(
    HttpApiEndpoint.get("vcs.get", "/chat/session/:sessionID/vcs", {
      params,
      success: SessionVcs.Info,
      error: [NotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "vcs.get",
        summary: "Read version control",
        description:
          "Return the version control of the session’s folder and its current and default branch. Without `provider`, the folder is not a repository and `vcs.diff` has nothing to show. A session without an environment refuses it.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("vcs.diff", "/chat/session/:sessionID/vcs/diff", {
      params,
      query: VcsDiffQuery,
      success: Schema.Array(SessionInfo.FileDiff),
      error: [NotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "vcs.diff",
        summary: "Diff the session’s folder",
        description:
          "Return a patch for each file that changed in the session’s repository, including files nobody has added yet. A folder that is not a repository returns no files. A comparison the repository cannot make, such as `committed` without a base branch, is refused, as is a session without an environment.",
      }),
    ),
  )
  .middleware(ChatAccess)
  .annotateMerge(OpenApi.annotations({ title: "vcs" }))

export const ChatApi = HttpApi.make("chat")
  .add(EventGroup)
  .add(ModelGroup)
  .add(SessionGroup)
  .add(ShellGroup)
  .add(AgentGroup)
  .add(SkillGroup)
  .add(CommandGroup)
  .add(FileGroup)
  .add(VcsGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren Chat API",
      version: "0.0.0",
      description: "The API a client uses to follow and drive one live session, served by the session’s brain.",
    }),
  )
