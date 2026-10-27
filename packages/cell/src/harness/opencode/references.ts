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

const archiveNote =
  "A reference is a copy of a GitHub archive: it has no submodules, no Git LFS file contents, no symlinks and no files marked export-ignore."

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
  // oxlint-disable-next-line ren/no-comments -- A reference reaches OpenCode only after its lookup: at the start, at a settings change and before each turn (R3, §5a). R36, R37: the start and a settings change look up in the background, one lookup at a time for the chat, and a prompt waits for it.
  const lookups = yield* Semaphore.make(1)
  const lookUp = lookups.withPermit(
    Effect.gen(function* () {
      const next = yield* prepare()
      if (Equal.equals(next, yield* Ref.get(current))) return
      yield* Ref.set(current, next)
      yield* input.context.reference.reload()
    }),
  )
  const scope = yield* Effect.scope
  const refresh = Effect.asVoid(Effect.forkIn(lookUp, scope))
  yield* refresh
  yield* input.context.reference.transform((editor) => {
    for (const prepared of Ref.getUnsafe(current).filter(isAvailable))
      editor.add(prepared.info.alias, {
        type: "local",
        path: AbsolutePath.make(prepared.path),
        ...(prepared.info.description && { description: prepared.info.description }),
      })
  })
  // oxlint-disable-next-line ren/no-comments -- R5, R44: the copies of the current generation, cleared at each prompt, so files deleted under the root come back at the next turn. The executor answers at once for a path that exists.
  const copied = { generation: Number.NaN, paths: new Set<string>() }
  yield* input.context.session.hook("prompt", () =>
    Effect.sync(() => copied.paths.clear()).pipe(Effect.andThen(lookUp)),
  )
  yield* input.context.session.hook("context", (event) =>
    Effect.sync(() => {
      const prepared = Ref.getUnsafe(current)
      if (prepared.some(isAvailable)) event.system.push({ type: "text", text: archiveNote })
      for (const each of prepared)
        if ("unavailable" in each) event.system.push({ type: "text", text: each.unavailable })
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
  // oxlint-disable-next-line ren/no-comments -- R17, R38: before an environment tool, each reference copies on its own. A copy that fails does not fail the tool: its cause goes into the tool result, and the next environment tool tries again.
  const notes = new Map<string, ReadonlyArray<string>>()
  const copying = yield* Semaphore.make(1)
  yield* input.context.tool.hook("execute.before", (event) => {
    const available = Ref.getUnsafe(current).filter(isAvailable)
    if (!OpenCodeSkills.environmentTools.includes(event.tool) || available.length === 0) return Effect.void
    return copying.withPermit(
      Effect.gen(function* () {
        const generation = yield* environment.generation.pipe(
          Effect.mapError((error) => new Tool.Error({ message: error.message })),
        )
        if (generation !== copied.generation) {
          copied.generation = generation
          copied.paths.clear()
        }
        const failures = yield* Effect.forEach(
          available.filter((prepared) => !copied.paths.has(prepared.path)),
          (prepared) =>
            environment.files
              .unpack({
                ...input.sources.reader.archive(prepared.lookup),
                folder: ".",
                path: prepared.path,
                maxBytes: EnvironmentApi.maxReferenceBytes,
                maxFiles: EnvironmentApi.maxReferenceFiles,
                links: "skip",
              })
              .pipe(
                Effect.as(Option.none<string>()),
                Effect.tap(() => Effect.sync(() => copied.paths.add(prepared.path))),
                Effect.catch((error) =>
                  Effect.succeed(
                    Option.some(
                      `The reference ${prepared.info.alias} is not on the environment: ${error.message}. The next environment tool copies it again.`,
                    ),
                  ),
                ),
              ),
          { concurrency: 4 },
        )
        const causes = failures.filter(Option.isSome).map((failure) => failure.value)
        if (causes.length > 0) notes.set(event.id, causes)
      }),
    )
  })
  yield* input.context.tool.hook("execute.after", (event) =>
    Effect.sync(() => {
      const causes = notes.get(event.id)
      if (!causes) return
      notes.delete(event.id)
      const note = causes.join("\n")
      if (event.status === "error") {
        event.error = new Tool.Error({ message: `${event.error.message}\n\n${note}` })
        return
      }
      const content = event.result.content
      event.result = {
        ...event.result,
        content:
          typeof content === "string"
            ? `${content}\n\n${note}`
            : [
                ...(content ??
                  ("output" in event.result
                    ? [{ type: "text" as const, text: JSON.stringify(event.result.output) }]
                    : [])),
                { type: "text" as const, text: note },
              ],
      }
    }),
  )
  return { refresh }
})
