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

export interface Project extends Schema.Schema.Type<typeof Project> {}
export const Project = Schema.Struct({
  path: Schema.String.annotate({
    description:
      "The repository’s folder, relative to the session’s folder and ending with `/`. Empty for the session’s folder.",
  }),
  branch: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "SessionVcs.Project", description: "A git repository in the session’s folder." })
