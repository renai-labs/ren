export * as ChannelOrigin from "./channel-origin.js"

import { Schema } from "effect"

export const Provider = Schema.Literals(["slack", "linear", "github"]).annotate({ identifier: "Channel.Provider" })
export type Provider = typeof Provider.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  provider: Provider,
  place: Schema.String,
  threadUrl: Schema.optionalKey(Schema.String),
  sender: Schema.String,
  handle: Schema.optionalKey(Schema.String),
  context: Schema.optionalKey(Schema.String),
}).annotate({
  identifier: "ChannelOrigin.Info",
  description: "Where a message from Slack, Linear or GitHub came from, and what its thread holds.",
})
