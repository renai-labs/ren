export * as Machine from "./machine.js"

import { Schema } from "effect"
import { EnvironmentTemplate } from "./environment-template.js"

export const Phase = Schema.Literals([
  "creating",
  "booting",
  "resuming",
  "updating",
  "waking",
  "replacing",
  "ready",
  "failed",
  "capacity",
  "stopped",
]).annotate({ identifier: "Machine.Phase" })
export type Phase = typeof Phase.Type

export interface Version extends Schema.Schema.Type<typeof Version> {}
export const Version = Schema.Struct({
  environmentTemplateId: EnvironmentTemplate.ID,
  image: Schema.NullOr(Schema.String).annotate({
    description: "The template’s image that the machine runs. Null for a provider that builds no image.",
  }),
  config: Schema.Json.annotate({ description: "The template config that built the image." }),
  system: Schema.NullOr(Schema.String).annotate({ description: "The system image that the image was built on." }),
}).annotate({
  identifier: "Machine.Version",
  description:
    "One build of a machine template. A machine keeps its version when the template changes, so Ren can make it again after a failure.",
})
