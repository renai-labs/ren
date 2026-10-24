export * as Workload from "./workload.js"

import { Schema } from "effect"
import { Brain } from "./brain.js"
import { Environment } from "./environment.js"

const Generation = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

export const Kind = Schema.Literals(["brain", "hand"]).annotate({ identifier: "Workload.Kind" })
export type Kind = typeof Kind.Type

export const Info = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("brain"), id: Brain.ID, generation: Generation }),
  Schema.Struct({ kind: Schema.Literal("hand"), id: Environment.ID, generation: Generation }),
]).annotate({
  identifier: "Workload.Info",
  description: "Code that runs for Ren, a brain or a hand, in one generation of its machine.",
})
export type Info = typeof Info.Type

export const key = (workload: Info) => `${workload.kind}:${workload.id}:${workload.generation}`
