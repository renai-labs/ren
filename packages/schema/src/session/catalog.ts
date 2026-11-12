export * as SessionCatalog from "./catalog.js"

import { Schema } from "effect"

export interface Agent extends Schema.Schema.Type<typeof Agent> {}
export const Agent = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  mode: Schema.Literals(["subagent", "primary", "all"]),
  hidden: Schema.Boolean,
  color: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "SessionCatalog.Agent" })

export interface Skill extends Schema.Schema.Type<typeof Skill> {}
export const Skill = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "SessionCatalog.Skill" })

export interface Command extends Schema.Schema.Type<typeof Command> {}
export const Command = Schema.Struct({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "SessionCatalog.Command" })

export const FileType = Schema.Literals(["file", "directory"]).annotate({ identifier: "SessionCatalog.FileType" })
export type FileType = typeof FileType.Type

export interface File extends Schema.Schema.Type<typeof File> {}
export const File = Schema.Struct({ path: Schema.String, type: FileType }).annotate({
  identifier: "SessionCatalog.File",
})

export interface FileContent extends Schema.Schema.Type<typeof FileContent> {}
export const FileContent = Schema.Struct({
  path: Schema.String,
  mime: Schema.String,
  size: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  encoding: Schema.Literals(["utf8", "base64"]),
  content: Schema.String,
  truncated: Schema.Boolean,
}).annotate({ identifier: "SessionCatalog.FileContent" })

export const mentionable = (agents: ReadonlyArray<Agent>) =>
  agents.filter((agent) => !agent.hidden && agent.mode !== "primary")
