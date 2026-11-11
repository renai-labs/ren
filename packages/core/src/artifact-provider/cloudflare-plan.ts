export * as ArtifactCloudflarePlan from "./cloudflare-plan.js"

import { Artifact } from "@ren/schema/artifact"
import { Result, Schema } from "effect"

export const State = Schema.Struct({
  objects: Artifact.DurableObjects,
  acknowledgedTag: Schema.NullOr(Schema.String),
  history: Schema.Array(Schema.Struct({ tag: Schema.String, new_sqlite_classes: Schema.Array(Schema.String) })),
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

export const confirmed = (previous: State, migrationTag: string | null) => {
  const planned = migrations({ previous, migrationTag, objects: previous.objects })
  if (Result.isFailure(planned)) return Result.fail(planned.failure)
  const index = planned.success.state.history.findIndex((step) => step.tag === migrationTag)
  const history = planned.success.state.history.slice(0, index + 1)
  const classes = new Set(history.flatMap((step) => step.new_sqlite_classes))
  return Result.succeed({
    ...planned.success.state,
    history,
    objects: Object.fromEntries(Object.entries(previous.objects).filter((entry) => classes.has(entry.at(1) ?? ""))),
  })
}

export const fence = (previous: State, tag: string): State => ({
  ...previous,
  history: [...previous.history, { tag, new_sqlite_classes: [] }],
})

export const migrations = (input: {
  readonly previous: State | null
  readonly objects: Artifact.Config["durableObjects"]
  readonly migrationTag: string | null
}) => {
  const previous = input.previous ?? { objects: {}, acknowledgedTag: null, history: [] }
  const objects = input.objects ?? {}
  if (Object.entries(previous.objects).some(([name, className]) => objects[name] !== className))
    return Result.fail("Keep existing Durable Object binding and class names; removal and renaming are not supported")

  const remote = input.migrationTag ? previous.history.findIndex((step) => step.tag === input.migrationTag) : -1
  if (input.migrationTag && remote === -1)
    return Result.fail("Cloudflare's migration tag is not in the retained artifact migration history")
  const acknowledged = previous.history.findIndex((step) => step.tag === previous.acknowledgedTag)
  if (remote < acknowledged)
    return Result.fail("Cloudflare's acknowledged Durable Object migration history has disappeared or moved backwards")

  const existing = new Set(Object.values(previous.objects))
  const added = [...new Set(Object.values(objects))].filter((name) => !existing.has(name)).toSorted()
  const history = added.length
    ? [...previous.history, { tag: `ren-sqlite-${previous.history.length + 1}`, new_sqlite_classes: added }]
    : previous.history
  const state = { objects, acknowledgedTag: input.migrationTag, history }
  return Result.succeed({ state })
}
