export * as Shell from "./shell.js"

import { Schema } from "effect"
import { Session } from "./session.js"
import { SessionMessage } from "./session/message.js"

export const ID = Schema.String.check(Schema.isStartingWith("sh_")).pipe(
  Schema.brand("Shell.ID"),
  Schema.annotate({ identifier: "Shell.ID" }),
)
export type ID = typeof ID.Type

export interface Time extends Schema.Schema.Type<typeof Time> {}
export const Time = Schema.Struct({
  started: Schema.Finite,
  completed: Schema.optionalKey(Schema.Finite),
}).annotate({ identifier: "Shell.Time" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  sessionID: Session.ID,
  status: SessionMessage.ShellStatus,
  command: Schema.String,
  exit: Schema.optionalKey(Schema.Finite),
  time: Time,
}).annotate({ identifier: "Shell.Info" })

const Bytes = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export interface Output extends Schema.Schema.Type<typeof Output> {}
export const Output = Schema.Struct({
  output: Schema.String,
  cursor: Bytes,
  size: Bytes,
  truncated: Schema.Boolean,
}).annotate({ identifier: "Shell.Output" })
