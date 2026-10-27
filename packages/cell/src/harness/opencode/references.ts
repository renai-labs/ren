export * as OpenCodeReferences from "./references.js"

import { AbsolutePath } from "@opencode/client/effect"
import type { Plugin } from "@opencode/plugin/effect"
import { References } from "@ren/brain/reference/references"
import { Repositories } from "@ren/brain/reference/repositories"
import { Environment } from "@ren/schema/environment"
import type { Reference } from "@ren/schema/reference"
import { Effect } from "effect"
import type { OpenCodeCopies } from "./copies.js"

const writes = new Set(["edit", "write", "patch"])

// oxlint-disable-next-line ren/no-comments -- R2, R49: one root in the folder that every session on the environment shares.
export const rootOf = (directory: string) => `${Environment.sharedDirectoryOf({ directory })}/${Repositories.root}`

export const make = Effect.fnUntraced(function* (input: {
  readonly context: Pick<Plugin.Context, "reference" | "session" | "permission" | "location">
  readonly hasEnvironment: boolean
  readonly repositories: Repositories.Interface
  readonly references: Effect.Effect<ReadonlyArray<Reference.Info>>
}) {
  // oxlint-disable-next-line ren/no-comments -- R7: a chat without an environment cannot read a reference, so it gets none.
  if (!input.hasEnvironment) return { refresh: Effect.void, items: (): ReadonlyArray<OpenCodeCopies.Item> => [] }
  const shared = Environment.sharedDirectoryOf({ directory: input.context.location.directory })
  const sources = [
    yield* input.repositories.chat({ references: input.references, changed: input.context.reference.reload() }),
  ]
  const ready = () =>
    sources.flatMap((source) =>
      source
        .prepared()
        .filter(References.isReady)
        .map((prepared) => ({ prepared, path: `${shared}/${source.root}/${prepared.path}` })),
    )
  yield* input.context.reference.transform((editor) => {
    for (const each of ready())
      editor.add(each.prepared.alias, {
        type: "local",
        path: AbsolutePath.make(each.path),
        ...(each.prepared.description && { description: each.prepared.description }),
      })
  })
  yield* input.context.session.hook("prompt", () =>
    Effect.forEach(sources, (source) => source.ready, { concurrency: "unbounded", discard: true }),
  )
  yield* input.context.session.hook("context", (event) =>
    Effect.sync(() => {
      for (const source of sources) {
        const prepared = source.prepared()
        if (prepared.some(References.isReady)) event.system.push({ type: "text", text: source.note })
        for (const each of prepared)
          if (each.type === "unavailable") event.system.push({ type: "text", text: each.note })
      }
    }),
  )
  yield* input.context.permission.hook("evaluate", (event) =>
    Effect.sync(() => {
      if (event.effect === "deny") return
      const insideOf = (source: References.Source) =>
        event.resources.filter((resource) => resource.startsWith(`${shared}/${source.root}/`))
      const written = writes.has(event.action) ? sources.find((source) => insideOf(source).length > 0) : undefined
      if (written) {
        event.effect = "deny"
        event.message = `${insideOf(written).join(", ")} ${written.readOnly}`
        return
      }
      if (
        event.action === "external_directory" &&
        event.resources.every((resource) => sources.some((source) => resource.startsWith(`${shared}/${source.root}/`)))
      )
        event.effect = "allow"
    }),
  )
  return {
    refresh: Effect.forEach(sources, (source) => source.refresh, { discard: true }),
    items: (): ReadonlyArray<OpenCodeCopies.Item> =>
      ready().map((each) => ({
        path: each.path,
        copy: each.prepared.copy,
        note: (message) =>
          `The reference ${each.prepared.alias} is not on the environment: ${message}. The next environment tool copies it again.`,
      })),
  }
})
