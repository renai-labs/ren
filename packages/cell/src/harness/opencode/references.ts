export * as OpenCodeReferences from "./references.js"

import { AbsolutePath } from "@opencode/client/effect"
import type { Plugin } from "@opencode/plugin/effect"
import type { Repositories } from "@ren/brain/reference/repositories"
import { EnvironmentApi } from "@ren/environment-api/environment-api"
import { Environment } from "@ren/schema/environment"
import { GitHost } from "@ren/schema/git-host"
import type { Reference } from "@ren/schema/reference"
import { Effect } from "effect"
import type { OpenCodeCopies } from "./copies.js"

const writes = new Set(["edit", "write", "patch"])

const archiveNote =
  "A reference is a copy of a GitHub archive: it has no submodules, no Git LFS file contents, no symlinks and no files marked export-ignore."

// oxlint-disable-next-line ren/no-comments -- R2, R49: one root in the folder that every session on the environment shares.
export const rootOf = (directory: string) => `${Environment.sharedDirectoryOf({ directory })}/references`

const nameOf = (repository: string) =>
  URL.parse(repository)
    ?.pathname.split("/")
    .filter(Boolean)
    .join("/")
    .replace(/\.git$/u, "") ?? repository

// oxlint-disable-next-line ren/no-comments -- R56: the OpenCode side of references. Repositories (brain) looks them up; this gives them to OpenCode as local references, guards the root and names the copies.
export const make = Effect.fnUntraced(function* (input: {
  readonly context: Pick<Plugin.Context, "reference" | "session" | "permission" | "location">
  readonly hasEnvironment: boolean
  readonly repositories: Repositories.Interface
  readonly references: Effect.Effect<ReadonlyArray<Reference.Info>>
}) {
  // oxlint-disable-next-line ren/no-comments -- R7: a chat without an environment cannot read a reference, so it gets none.
  if (!input.hasEnvironment) return { refresh: Effect.void, items: (): ReadonlyArray<OpenCodeCopies.Item> => [] }
  const root = rootOf(input.context.location.directory)
  const chat = yield* input.repositories.chat({
    references: input.references,
    changed: input.context.reference.reload(),
  })
  const ready = () => chat.prepared().filter((prepared) => prepared.type === "ready")
  yield* input.context.reference.transform((editor) => {
    for (const prepared of ready())
      editor.add(prepared.info.alias, {
        type: "local",
        path: AbsolutePath.make(`${root}/${prepared.path}`),
        ...(prepared.info.description && { description: prepared.info.description }),
      })
  })
  yield* input.context.session.hook("prompt", () => chat.ready)
  yield* input.context.session.hook("context", (event) =>
    Effect.sync(() => {
      const prepared = chat.prepared()
      if (prepared.some((each) => each.type === "ready")) event.system.push({ type: "text", text: archiveNote })
      for (const each of prepared)
        if (each.type === "unavailable")
          event.system.push({
            type: "text",
            text: `The reference ${each.info.alias} (${nameOf(each.info.repository)}) is not available: ${GitHost.message(each.unavailable)}.`,
          })
    }),
  )
  yield* input.context.permission.hook("evaluate", (event) =>
    Effect.sync(() => {
      if (event.effect === "deny") return
      const inside = event.resources.filter((resource) => resource.startsWith(`${root}/`))
      if (writes.has(event.action) && inside.length > 0) {
        event.effect = "deny"
        event.message = `${inside.join(", ")} is a read-only copy of a reference. To change code, clone the repository.`
        return
      }
      if (event.action === "external_directory" && inside.length === event.resources.length) event.effect = "allow"
    }),
  )
  return {
    refresh: chat.refresh,
    items: (): ReadonlyArray<OpenCodeCopies.Item> =>
      ready().map((prepared) => ({
        path: `${root}/${prepared.path}`,
        copy: {
          type: "archive",
          unpack: {
            ...prepared.archive,
            folder: ".",
            maxBytes: EnvironmentApi.maxReferenceBytes,
            maxFiles: EnvironmentApi.maxReferenceFiles,
            links: "skip",
          },
        },
        note: (message) =>
          `The reference ${prepared.info.alias} is not on the environment: ${message}. The next environment tool copies it again.`,
      })),
  }
})
