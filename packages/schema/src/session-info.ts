export * as SessionInfo from "./session-info.js"

import { Schema } from "effect"
import { Session } from "./session.js"
import { SessionCapabilities } from "./session-capabilities.js"
import { SessionMessage } from "./session-message.js"
import { SessionModel } from "./session-model.js"

export interface FileDiff extends Schema.Schema.Type<typeof FileDiff> {}
export const FileDiff = Schema.Struct({
  file: Schema.String,
  patch: Schema.String,
  additions: Schema.Int,
  deletions: Schema.Int,
  status: Schema.Literals(["added", "deleted", "modified"]),
}).annotate({ identifier: "SessionInfo.FileDiff" })

export interface Revert extends Schema.Schema.Type<typeof Revert> {}
export const Revert = Schema.Struct({
  messageID: SessionMessage.ID,
  snapshot: Schema.optionalKey(Schema.String),
  files: Schema.optionalKey(Schema.Array(FileDiff)),
}).annotate({ identifier: "SessionInfo.Revert" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: Session.ID,
  parentID: Schema.optionalKey(Session.ID),
  title: Schema.optionalKey(Schema.String),
  agent: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(SessionModel.Ref),
  cost: Schema.Finite,
  tokens: SessionMessage.TokenUsage,
  outcome: Schema.optionalKey(SessionMessage.Outcome),
  time: Schema.Struct({
    created: SessionMessage.Time,
    updated: SessionMessage.Time,
    idle: Schema.optionalKey(SessionMessage.Time),
  }),
  revert: Schema.optionalKey(Revert),
  capabilities: SessionCapabilities.Info,
}).annotate({ identifier: "SessionInfo.Info" })
