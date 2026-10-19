export * as Session from "./session.js"

import { Effect, Schema, Struct } from "effect"
import { Auth } from "./auth.js"
import { Environment } from "./environment.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { SessionCapabilities } from "./session-capabilities.js"
import { SessionMessage } from "./session-message.js"
import { SessionModel } from "./session-model.js"
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

const instructionKey = /^[a-z0-9][a-z0-9._-]*$/u

export const Instructions = Schema.Record(
  Schema.String,
  Schema.String.check(
    Schema.makeFilter(
      (value) => encoder.encode(JSON.stringify(value)).length <= 256 * 1024 || "an instruction is at most 256 KiB",
    ),
  ),
)
  .check(
    Schema.makeFilter(
      (instructions) =>
        Object.keys(instructions).every((key) => instructionKey.test(key)) ||
        "instruction keys are lowercase letters, digits, dot, underscore and dash, starting with a letter or digit",
    ),
  )
  .annotate({ identifier: "Session.Instructions" })
export type Instructions = typeof Instructions.Type

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
export const Sender = Schema.Struct({ userId: Schema.NonEmptyString }).annotate({ identifier: "Session.Sender" })

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
  agent: Schema.optionalKey(Schema.NonEmptyString),
  model: Schema.optionalKey(Model),
  instructions: Instructions.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
  interactive: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
  environment: Schema.optionalKey(Environment.Location),
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

export interface ClientAccess extends Schema.Schema.Type<typeof ClientAccess> {}
export const ClientAccess = Schema.Struct({
  url: Schema.String,
  token: Schema.String,
  expiresAt: Schema.DateTimeUtc,
}).annotate({ identifier: "Session.ClientAccess" })

export interface HostState extends Schema.Schema.Type<typeof HostState> {}
export const HostState = Schema.Struct({
  isOpen: Schema.Boolean,
  holders: Schema.Int,
  waitingSince: Schema.NullOr(Schema.DateTimeUtc),
  nextReconcileAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "Session.HostState" })

export const Status = Schema.Literals(["idle", "busy"]).annotate({ identifier: "Session.Status" })
export type Status = typeof Status.Type

export interface ForkSource extends Schema.Schema.Type<typeof ForkSource> {}
export const ForkSource = Schema.Struct({
  sessionId: ID,
  messageId: SessionMessage.ID,
}).annotate({ identifier: "Session.ForkSource" })

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
  forkedFrom: Schema.NullOr(ForkSource).annotate({
    description: "The session and message this session was forked before, if it is a fork.",
  }),
  unread: Schema.Boolean.annotate({
    description:
      "Whether the session changed after the caller last read it with `chat.read`. A session the caller never read is unread once it changes after it was created.",
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
    description: "The model and variant the session starts with, from `chat.models`. Without it the brain picks one.",
  }),
}).annotate({ identifier: "Session.CreateInput" })

export interface ForkInput extends Schema.Schema.Type<typeof ForkInput> {}
export const ForkInput = Schema.Struct({
  id: ID.annotate({ description: "The ID of the new session. The client mints it, so a retry is safe." }),
  messageId: SessionMessage.ID.annotate({
    description: "The fork starts with the source’s messages before this one.",
  }),
}).annotate({ identifier: "Session.ForkInput" })

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
