export * as ReferenceCache from "./cache.js"

import { Cache, Duration, Effect, Exit, MutableHashMap, Option } from "effect"
import { GitHubReader } from "../github/reader.js"

export interface Reference {
  readonly repository: string
  readonly branch?: string
}

export interface Interface {
  readonly resolve: (reference: Reference) => Effect.Effect<GitHubReader.Lookup, GitHubReader.Failed>
}

export const refreshAfter = Duration.days(1)

export const retryAfter = Duration.minutes(1)

// oxlint-disable-next-line ren/no-comments -- R3: one lookup per reference and day for the whole brain. A failed lookup is tried again after a minute and keeps the last good commit until then; a commit in the branch never changes.
export const make = Effect.fnUntraced(function* (reader: GitHubReader.Interface) {
  const lastGood = MutableHashMap.empty<Reference, GitHubReader.Lookup>()
  const cache = yield* Cache.makeWith(
    (reference: Reference) =>
      reader.lookup(reference.repository, reference.branch).pipe(
        Effect.tap((lookup) => Effect.sync(() => MutableHashMap.set(lastGood, reference, lookup))),
        Effect.map((lookup) => ({ lookup, isFresh: true })),
        Effect.catch((error) => {
          const kept = MutableHashMap.get(lastGood, reference)
          return Option.isSome(kept)
            ? Effect.logWarning(`Keeping the last good lookup of ${reference.repository}: ${error.message}`).pipe(
                Effect.as({ lookup: kept.value, isFresh: false }),
              )
            : Effect.fail(error)
        }),
      ),
    {
      capacity: Number.MAX_SAFE_INTEGER,
      timeToLive: (exit, reference) => {
        if (Exit.isFailure(exit) || !exit.value.isFresh) return retryAfter
        return GitHubReader.commitPattern.test(reference.branch ?? "") ? Duration.infinity : refreshAfter
      },
    },
  )
  return {
    resolve: (reference) =>
      Cache.get(cache, {
        repository: reference.repository,
        ...(reference.branch && { branch: reference.branch }),
      }).pipe(Effect.map((entry) => entry.lookup)),
  } satisfies Interface
})
