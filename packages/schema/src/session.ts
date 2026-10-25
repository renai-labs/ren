export * as Session from "./session.js"

import { Effect, Schema, Struct } from "effect"
import { Auth } from "./auth.js"
import { EnvironmentTemplate } from "./environment-template.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { SessionCapabilities } from "./session/capabilities.js"
import { SessionMessage } from "./session/message.js"
import { SessionModel } from "./session/model.js"
import { Space } from "./space.js"

const encoder = new TextEncoder()

export const ID = Identifier.make("ses", "Session.ID")
export type ID = typeof ID.Type

export const MessageID = Identifier.make("msg", "Session.MessageID")
export type MessageID = typeof MessageID.Type

export const Harness = Schema.Literals(["opencode"]).annotate({ identifier: "Session.Harness" })
export type Harness = typeof Harness.Type

export interface Model extends Schema.Schema.Type<typeof Model> {}
export const Model = Schema.Struct({
  endpointId: Schema.NonEmptyString,
  modelId: Schema.NonEmptyString,
  variant: Schema.optionalKey(Schema.NonEmptyString),
}).annotate({ identifier: "Session.Model" })

export const Delivery = Schema.Literals(["steer", "queue"]).annotate({ identifier: "Session.Delivery" })
export type Delivery = typeof Delivery.Type

export const maxFileBytes = 10_000_000
export const maxBodyBytes = 16_000_000

export const fileBytes = (url: string) => {
  const comma = url.indexOf(",")
  const data = url.slice(comma + 1)
  return /;base64$/iu.test(url.slice(0, comma))
    ? Math.floor((data.replace(/=+$/, "").length * 3) / 4)
    : encoder.encode(data.replaceAll(/%[a-f0-9]{2}/giu, "x")).length
}

export interface File extends Schema.Schema.Type<typeof File> {}
export const File = Schema.Struct({
  url: Schema.String.check(
    Schema.isPattern(/^data:[a-z]+\/[a-z0-9.+-]+(;[^,]*)?,/iu),
    Schema.isMaxLength(maxBodyBytes),
    Schema.makeFilter((url) => fileBytes(url) <= maxFileBytes || "a file is at most 10 MB"),
  ),
  name: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "Session.File" })

export interface Prompt extends Schema.Schema.Type<typeof Prompt> {}
export const Prompt = Schema.Struct({
  text: Schema.NonEmptyString,
  files: Schema.optionalKey(
    Schema.Array(File).check(
      Schema.makeFilter(
        (files) =>
          files.reduce((bytes, file) => bytes + fileBytes(file.url), 0) <= maxFileBytes ||
          "a message's files total at most 10 MB",
      ),
    ),
  ),
}).annotate({ identifier: "Session.Prompt" })

export interface Sender extends Schema.Schema.Type<typeof Sender> {}
export const Sender = Schema.Struct({
  userId: Schema.NonEmptyString,
  memberId: Schema.optionalKey(Auth.MemberID).annotate({
    description: "The sender's membership in the organization. Ren sets it on every send; older stored messages lack it.",
  }),
}).annotate({ identifier: "Session.Sender" })

export interface SendInput extends Schema.Schema.Type<typeof SendInput> {}
export const SendInput = Schema.Struct({
  sessionId: ID,
  messageId: MessageID,
  prompt: Prompt,
  delivery: Delivery.pipe(Schema.withDecodingDefaultKey(Effect.succeed("steer" as const))),
  sender: Sender,
}).annotate({ identifier: "Session.SendInput" })

export interface StartInput extends Schema.Schema.Type<typeof StartInput> {}
export const StartInput = Schema.Struct({
  sessionId: ID,
  harness: Harness,
  title: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Model),
  interactive: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
  environmentTemplateId: Schema.optionalKey(EnvironmentTemplate.ID),
  initialMessage: Schema.optionalKey(
    SendInput.mapFields(Struct.omit(["sessionId", "delivery"])).annotate({
      identifier: "Session.InitialMessage",
    }),
  ),
}).annotate({ identifier: "Session.StartInput" })

export interface Started extends Schema.Schema.Type<typeof Started> {}
export const Started = Schema.Struct({ sessionId: ID, harness: Harness }).annotate({ identifier: "Session.Started" })

export interface Accepted extends Schema.Schema.Type<typeof Accepted> {}
export const Accepted = Schema.Struct({ messageId: MessageID }).annotate({ identifier: "Session.Accepted" })

export interface ReadyAccess extends Schema.Schema.Type<typeof ReadyAccess> {}
export const ReadyAccess = Schema.Struct({
  status: Schema.Literal("ready"),
  url: Schema.String,
  token: Schema.String,
  expiresAt: Schema.DateTimeUtc,
}).annotate({ identifier: "Session.ReadyAccess" })

export const ClientAccess = Schema.Union([
  ReadyAccess,
  Schema.Struct({
    status: Schema.Literal("starting"),
    phase: Schema.String.annotate({ description: "What the brain is doing. Ask again in 2 seconds." }),
  }).annotate({ identifier: "Session.StartingAccess" }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    reason: Schema.String,
  }).annotate({ identifier: "Session.FailedAccess" }),
]).annotate({ identifier: "Session.ClientAccess" })
export type ClientAccess = typeof ClientAccess.Type

export interface HostState extends Schema.Schema.Type<typeof HostState> {}
export const HostState = Schema.Struct({
  isOpen: Schema.Boolean,
  holders: Schema.Int,
  waitingSince: Schema.NullOr(Schema.DateTimeUtc),
  nextReconcileAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "Session.HostState" })

export const Status = Schema.Literals(["idle", "busy"]).annotate({ identifier: "Session.Status" })
export type Status = typeof Status.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  spaceId: Space.ID,
  createdBy: Auth.UserID,
  harness: Harness,
  title: Schema.NullOr(Schema.String),
  status: Status,
  capabilities: SessionCapabilities.Info,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
  filesResetAt: Schema.NullOr(Schema.DateTimeUtc).annotate({
    description: "When the chat moved to a new machine and its workspace files from before were lost, or null.",
  }),
}).annotate({ identifier: "Session.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  spaceId: Schema.optional(Space.ID),
  ...Pagination.fields(50),
}).annotate({ identifier: "Session.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "Session.Page" })

export interface FirstMessage extends Schema.Schema.Type<typeof FirstMessage> {}
export const FirstMessage = Schema.Struct({
  id: SessionMessage.ID,
  text: Schema.NonEmptyString,
}).annotate({ identifier: "Session.FirstMessage" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  id: ID,
  spaceId: Space.ID,
  message: Schema.optional(FirstMessage),
  model: Schema.optional(SessionModel.Ref).annotate({
    description:
      "The model and variant the session starts with, from `chat.models`. Without it the session’s settings give the model.",
  }),
}).annotate({ identifier: "Session.CreateInput" })

export const definition = Primitive.define({
  name: "session",
  plural: "sessions",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  get: true,
  create: { input: CreateInput, result: Info },
  archive: true,
})
