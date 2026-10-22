export * as SessionCapabilities from "./capabilities.js"

import { Schema } from "effect"
import type { Session } from "../session.js"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  steer: Schema.Boolean,
  queue: Schema.Boolean,
  interrupt: Schema.Boolean,
  model: Schema.Boolean,
  permissions: Schema.Boolean,
  forms: Schema.Boolean,
  revert: Schema.Boolean,
  compact: Schema.Boolean,
  shell: Schema.Boolean,
  commands: Schema.Boolean,
  rename: Schema.Boolean,
  files: Schema.Boolean,
}).annotate({ identifier: "SessionCapabilities.Info" })

export const of = (harness: Session.Harness): Info =>
  ({
    opencode: {
      steer: true,
      queue: true,
      interrupt: true,
      model: true,
      permissions: true,
      forms: true,
      revert: true,
      compact: true,
      shell: true,
      commands: true,
      rename: true,
      files: false,
    },
  })[harness]
