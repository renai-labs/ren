export * as SessionSettings from "./settings.js"

import { Schema } from "effect"
import { Settings } from "../settings.js"

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
  settings: Settings.Info,
}).annotate({ identifier: "SessionSettings.AgentLayer" })

export interface Layers extends Schema.Schema.Type<typeof Layers> {}
export const Layers = Schema.Struct({
  ren: Layer,
  organization: Layer,
  space: Layer,
  agents: Schema.Array(AgentLayer),
}).annotate({ identifier: "SessionSettings.Layers" })
