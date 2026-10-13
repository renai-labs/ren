export * as Session from "./session.js"

import { Credential } from "@opencode/schema/credential"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import { Effect, Schema } from "effect"
import { Identifier } from "./identifier.js"

const encoder = new TextEncoder()

export const ID = Identifier.make("ses", "Session.ID")
export type ID = typeof ID.Type

export const MessageID = Identifier.make("msg", "Session.MessageID")
export type MessageID = typeof MessageID.Type

export const Harness = Schema.Literals(["opencode"]).annotate({ identifier: "Session.Harness" })
export type Harness = typeof Harness.Type

export interface Model extends Schema.Schema.Type<typeof Model> {}
export const Model = Schema.Struct({
  providerId: Schema.NonEmptyString,
  modelId: Schema.NonEmptyString,
  variant: Schema.optionalKey(Schema.NonEmptyString),
}).annotate({ identifier: "Session.Model" })

const contextKey = /^[a-z0-9][a-z0-9._-]*$/u

export const Context = Schema.Record(
  Schema.String,
  Schema.String.check(
    Schema.makeFilter(
      (value) => encoder.encode(JSON.stringify(value)).length <= 256 * 1024 || "a context value is at most 256 KiB",
    ),
  ),
)
  .check(
    Schema.makeFilter(
      (context) =>
        Object.keys(context).every((key) => contextKey.test(key)) ||
        "context keys are lowercase letters, digits, dot, underscore and dash, starting with a letter or digit",
    ),
  )
  .annotate({ identifier: "Session.Context" })
export type Context = typeof Context.Type

export const ManagedMethod = IntegrationMethodID.make("ren")

export const Credentials = Schema.Record(Schema.String, Credential.Value)
  .check(
    Schema.makeFilter(
      (credentials) => Object.keys(credentials).every((key) => key.length > 0) || "a provider id is not empty",
    ),
  )
  .annotate({ identifier: "Session.Credentials" })
export type Credentials = typeof Credentials.Type

export interface StartInput extends Schema.Schema.Type<typeof StartInput> {}
export const StartInput = Schema.Struct({
  sessionId: ID,
  harness: Harness,
  title: Schema.optionalKey(Schema.String),
  agent: Schema.optionalKey(Schema.NonEmptyString),
  model: Schema.optionalKey(Model),
  context: Context.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
  credentials: Credentials.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
  interactive: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
}).annotate({ identifier: "Session.StartInput" })

export const Delivery = Schema.Literals(["steer", "queue"]).annotate({ identifier: "Session.Delivery" })
export type Delivery = typeof Delivery.Type

export interface File extends Schema.Schema.Type<typeof File> {}
export const File = Schema.Struct({
  url: Schema.String.check(Schema.isPattern(/^data:[a-z]+\/[a-z0-9.+-]+(;[^,]*)?,/iu)),
  name: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "Session.File" })

export interface Prompt extends Schema.Schema.Type<typeof Prompt> {}
export const Prompt = Schema.Struct({
  text: Schema.NonEmptyString,
  files: Schema.optionalKey(Schema.Array(File)),
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
  credentials: Schema.optionalKey(Credentials),
}).annotate({ identifier: "Session.SendInput" })

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
