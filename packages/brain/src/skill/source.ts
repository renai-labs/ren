export * as SkillSource from "./source.js"

import type { Skill } from "@ren/schema/skill"
import { Effect, Option, Schema } from "effect"
import type { GitHubReader } from "../github/reader.js"

export class Failed extends Schema.TaggedError<Failed>()("SkillSource.Failed", { message: Schema.String }) {}

export type Pointer = Skill.Upstream["upstream"]

export interface Resolved {
  readonly lookup: GitHubReader.Lookup
  readonly document: string
}

export interface Interface {
  readonly resolve: (pointer: Pointer) => Effect.Effect<Resolved, Failed>
  readonly archive: (resolved: Resolved) => GitHubReader.Archive
}

export const make = (reader: GitHubReader.Interface): Interface => ({
  resolve: Effect.fn("SkillSource.resolve")(function* (pointer: Pointer) {
    const failed = (error: GitHubReader.Failed) => new Failed({ message: error.message })
    const lookup = yield* reader.lookup(pointer.url, pointer.ref).pipe(Effect.mapError(failed))
    const file = pointer.path === "." ? "SKILL.md" : `${pointer.path}/SKILL.md`
    const document = yield* reader.read(lookup, file).pipe(Effect.mapError(failed))
    if (Option.isNone(document))
      return yield* new Failed({ message: `${pointer.url} has no ${file} at ${lookup.commit}` })
    return { lookup, document: document.value }
  }),
  archive: (resolved) => reader.archive(resolved.lookup),
})
