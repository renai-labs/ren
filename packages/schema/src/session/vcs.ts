export * as SessionVcs from "./vcs.js"

import { Schema } from "effect"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  provider: Schema.optionalKey(Schema.String),
  branch: Schema.Struct({
    current: Schema.optionalKey(Schema.String),
    default: Schema.optionalKey(Schema.String),
  }),
}).annotate({ identifier: "SessionVcs.Info" })

export const Mode = Schema.Literals(["working", "branch", "committed"]).annotate({ identifier: "SessionVcs.Mode" })
export type Mode = typeof Mode.Type
