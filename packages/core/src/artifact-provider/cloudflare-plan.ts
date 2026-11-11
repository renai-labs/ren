export * as ArtifactCloudflarePlan from "./cloudflare-plan.js"

import { Artifact } from "@ren/schema/artifact"
import { Result, Schema } from "effect"

export const State = Schema.Struct({
  objects: Artifact.DurableObjects,
})
export type State = typeof State.Type

export const bindings = (input: {
  readonly active: Readonly<Record<string, string>>
  readonly retained: Readonly<Record<string, string>>
  readonly desired: Readonly<Record<string, string>>
}) => {
  if (Object.values(input.desired).includes("default"))
    return Result.fail("Export Durable Objects by name; default is the Worker request entrypoint")
  if (
    Object.entries(input.active).some(([name, className]) => input.desired[name] !== className) ||
    Object.entries(input.desired).some(
      ([name, className]) => Object.hasOwn(input.retained, name) && input.retained[name] !== className,
    )
  )
    return Result.fail("Keep existing Durable Object binding and class names; removal and renaming are not supported")
  return Result.succeed({ ...input.retained, ...input.desired })
}

export const exports = (objects: Readonly<Record<string, string>>) =>
  Object.fromEntries(
    [...new Set(Object.values(objects))].map((name) => [name, { type: "durable-object", storage: "sqlite" }]),
  )
