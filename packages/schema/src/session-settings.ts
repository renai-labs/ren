export * as SessionSettings from "./session-settings.js"

import { Schema } from "effect"
import { Settings } from "./settings.js"

export interface Known extends Schema.Schema.Type<typeof Known> {}
export const Known = Schema.Struct({
  ren: Schema.optionalKey(Schema.String),
  organization: Schema.optionalKey(Schema.String),
  space: Schema.optionalKey(Schema.String),
  agents: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
}).annotate({ identifier: "SessionSettings.Known" })

export interface Layer extends Schema.Schema.Type<typeof Layer> {}
export const Layer = Schema.Struct({
  hash: Schema.NullOr(Schema.String),
  settings: Schema.optionalKey(Settings.Info),
}).annotate({ identifier: "SessionSettings.Layer" })

export interface AgentLayer extends Schema.Schema.Type<typeof AgentLayer> {}
export const AgentLayer = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  isSubagent: Schema.Boolean,
  hash: Schema.String,
  settings: Schema.optionalKey(Settings.Info),
}).annotate({ identifier: "SessionSettings.AgentLayer" })

export interface Layers extends Schema.Schema.Type<typeof Layers> {}
export const Layers = Schema.Struct({
  ren: Layer,
  organization: Layer,
  space: Layer,
  agents: Schema.Array(AgentLayer),
}).annotate({ identifier: "SessionSettings.Layers" })
