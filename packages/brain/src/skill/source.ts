export * as SkillSource from "./source.js"

import type { Skill } from "@ren/schema/skill"
import { Effect, Option, Schema } from "effect"
import type { GitHosts } from "../git/hosts.js"

export class Failed extends Schema.TaggedError<Failed>()("SkillSource.Failed", { message: Schema.String }) {}

export type Pointer = Skill.Upstream["upstream"]

export interface Resolved {
  readonly lookup: GitHosts.Lookup
  readonly document: string
}

export interface Interface {
  readonly resolve: (pointer: Pointer) => Effect.Effect<Resolved, Failed>
}

// oxlint-disable-next-line ren/no-comments -- R20, R54: a skill reads through the git hosts, as a reference does.
export const make = (hosts: GitHosts.Interface): Interface => ({
  resolve: Effect.fn("SkillSource.resolve")(function* (pointer: Pointer) {
    const failed = (error: GitHosts.Failed) => new Failed({ message: error.message })
    const lookup = yield* hosts.lookup(pointer.url, pointer.ref).pipe(Effect.mapError(failed))
    const file = pointer.path === "." ? "SKILL.md" : `${pointer.path}/SKILL.md`
    const document = yield* hosts.read(lookup, file).pipe(Effect.mapError(failed))
    if (Option.isNone(document))
      return yield* new Failed({ message: `${pointer.url} has no ${file} at ${lookup.commit}` })
    return { lookup, document: document.value }
  }),
})
