export * as RenInference from "./ren-inference.js"

import { Schema } from "effect"

export interface Meter extends Schema.Schema.Type<typeof Meter> {}
export const Meter = Schema.Struct({
  key: Schema.String,
  title: Schema.String,
  percent: Schema.NullOr(Schema.Number),
  resetsAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
}).annotate({ identifier: "RenInference.Meter" })

export const Tone = Schema.Literals(["ok", "warn", "error"]).annotate({ identifier: "RenInference.Tone" })
export type Tone = typeof Tone.Type

export interface Connection extends Schema.Schema.Type<typeof Connection> {}
export const Connection = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  providerName: Schema.String,
  iconUrl: Schema.String,
  status: Schema.Struct({ label: Schema.String, tone: Tone }),
  plan: Schema.optionalKey(Schema.String),
  canReconnect: Schema.Boolean,
  canManage: Schema.Boolean.annotate({
    description:
      "True when the viewer connected it, or is an admin or owner: they can rename, reconnect and remove it.",
  }),
  meters: Schema.Array(Meter),
}).annotate({
  identifier: "RenInference.Connection",
  description: "A model provider the organization connected, with display data from the Ren Inference Service.",
})

export interface ConnectInput extends Schema.Schema.Type<typeof ConnectInput> {}
export const ConnectInput = Schema.Struct({
  returnUrl: Schema.String.check(Schema.isMaxLength(2048)).annotate({
    description: "The Ren app page the browser comes back to after the sign-in.",
  }),
  connectionId: Schema.optional(Schema.String.annotate({ description: "Set to reconnect this connection." })),
}).annotate({ identifier: "RenInference.ConnectInput" })

export interface ConnectResult extends Schema.Schema.Type<typeof ConnectResult> {}
export const ConnectResult = Schema.Struct({
  url: Schema.String.annotate({ description: "The sign-in page. Send the browser here." }),
}).annotate({ identifier: "RenInference.ConnectResult" })

export interface RenameInput extends Schema.Schema.Type<typeof RenameInput> {}
export const RenameInput = Schema.Struct({
  label: Schema.String.check(
    Schema.isMinLength(1, { message: "Enter a name." }),
    Schema.isMaxLength(64, { message: "Use 64 characters or fewer." }),
  ),
}).annotate({ identifier: "RenInference.RenameInput" })
