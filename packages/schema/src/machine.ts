export * as Machine from "./machine.js"

import { Schema } from "effect"

export const Phase = Schema.Literals([
  "creating",
  "booting",
  "resuming",
  "waking",
  "replacing",
  "ready",
  "failed",
  "capacity",
]).annotate({ identifier: "Machine.Phase" })
export type Phase = typeof Phase.Type
