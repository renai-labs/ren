export * as OpenCodeReferences from "./references.js"

import { AbsolutePath } from "@opencode/client/effect"
import type { Plugin } from "@opencode/plugin/effect"
import { Tool } from "@opencode/schema/tool"
import type { EnvironmentSession } from "@ren/brain/environment/session"
import type { GitHubReader } from "@ren/brain/github/reader"
import type { ReferenceCache } from "@ren/brain/reference/cache"
import { EnvironmentApi } from "@ren/environment-api/environment-api"
import type { Reference } from "@ren/schema/reference"
import { Effect, Equal, Option, Ref, Semaphore } from "effect"
import { dirname } from "node:path"
import { OpenCodeSkills } from "./skills.js"

export interface Sources {
  readonly reader: GitHubReader.Interface
  readonly cache: ReferenceCache.Interface
}

type Prepared =
  | { readonly info: Reference.Info; readonly path: string; readonly lookup: GitHubReader.Lookup }
  | { readonly info: Reference.Info; readonly unavailable: string }

const writes = new Set(["edit", "write", "patch"])

const isAvailable = (prepared: Prepared): prepared is Extract<Prepared, { readonly path: string }> => "path" in prepared

// oxlint-disable-next-line ren/no-comments -- R2: one root beside the chat folders, shared by every chat on the environment.
export const rootOf = (directory: string) => `${dirname(directory)}/.ren/references`

const nameOf = (repository: string) =>
  URL.parse(repository)
    ?.pathname.split("/")
    .filter(Boolean)
    .slice(0, 2)
    .join("/")
    .replace(/\.git$/u, "") ?? repository

export const make = Effect.fnUntraced(function* (input: {
  readonly context: Pick<Plugin.Context, "reference" | "tool" | "session" | "permission" | "location">
  readonly environment: Option.Option<{
    readonly files: EnvironmentSession.Files
    readonly generation: Effect.Effect<number, { readonly message: string }>
  }>
  readonly sources: Sources
  readonly references: Effect.Effect<ReadonlyArray<Reference.Info>>
}) {
  // oxlint-disable-next-line ren/no-comments -- R7: a chat without an environment cannot read a reference, so it gets none.
  if (Option.isNone(input.environment)) return { refresh: Effect.void }
  const environment = input.environment.value
  const root = rootOf(input.context.location.directory)
  const current = yield* Ref.make<ReadonlyArray<Prepared>>([])
  const prepare = Effect.fnUntraced(function* () {
    return yield* Effect.forEach(
      yield* input.references,
      (info) =>
        input.sources.cache.resolve({ repository: info.repository, ...(info.branch && { branch: info.branch }) }).pipe(
          Effect.timeout("20 seconds"),
          Effect.map((lookup): Prepared => ({
            info,
            lookup,
            path: `${root}/${lookup.hosts.host}/${lookup.repository.owner}/${lookup.repository.repo}/${lookup.commit.slice(0, 12)}`,
          })),
          Effect.catch((error) =>
            Effect.succeed<Prepared>({
              info,
              unavailable: `The reference ${info.alias} (${nameOf(info.repository)}) is not available: ${error.message}.`,
            }),
          ),
        ),
      { concurrency: 8 },
    )
  })
  // oxlint-disable-next-line ren/no-comments -- A reference reaches OpenCode only after its lookup: at the start, at a settings change and before each turn (R3, §5a).
  const refresh = Effect.gen(function* () {
    const next = yield* prepare()
    if (Equal.equals(next, yield* Ref.get(current))) return
    yield* Ref.set(current, next)
    yield* input.context.reference.reload()
  })
  yield* Ref.set(current, yield* prepare())
  yield* input.context.reference.transform((editor) => {
    for (const prepared of Ref.getUnsafe(current).filter(isAvailable))
      editor.add(prepared.info.alias, {
        type: "local",
        path: AbsolutePath.make(prepared.path),
        ...(prepared.info.description && { description: prepared.info.description }),
      })
  })
  yield* input.context.session.hook("prompt", () => refresh)
  yield* input.context.session.hook("context", (event) =>
    Effect.sync(() => {
      for (const prepared of Ref.getUnsafe(current))
        if ("unavailable" in prepared) event.system.push({ type: "text", text: prepared.unavailable })
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
  // oxlint-disable-next-line ren/no-comments -- R5, R17: before the first environment tool, every reference of the chat is on the environment of the current generation.
  const unpacked = new Set<string>()
  const unpacking = yield* Semaphore.make(1)
  yield* input.context.tool.hook("execute.before", (event) => {
    const available = Ref.getUnsafe(current).filter(isAvailable)
    if (!OpenCodeSkills.environmentTools.includes(event.tool) || available.length === 0) return Effect.void
    return unpacking.withPermit(
      Effect.gen(function* () {
        const generation = yield* environment.generation.pipe(
          Effect.mapError((error) => new Tool.Error({ message: error.message })),
        )
        yield* Effect.forEach(
          available,
          (prepared) => {
            const key = `${generation} ${prepared.path}`
            if (unpacked.has(key)) return Effect.void
            return environment.files
              .unpack({
                ...input.sources.reader.archive(prepared.lookup),
                folder: ".",
                path: prepared.path,
                maxBytes: EnvironmentApi.maxReferenceBytes,
                maxFiles: EnvironmentApi.maxReferenceFiles,
                links: "skip",
              })
              .pipe(
                Effect.tap(() => Effect.sync(() => unpacked.add(key))),
                Effect.mapError(
                  (error) =>
                    new Tool.Error({
                      message: `The reference ${prepared.info.alias} is not on the environment: ${error.message}. Retry the environment tool to copy it again.`,
                    }),
                ),
              )
          },
          { concurrency: 4, discard: true },
        )
      }),
    )
  })
  return { refresh }
})
