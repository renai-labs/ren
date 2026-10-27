export * as ReferenceCache from "./cache.js"

import { Cache, Duration, Effect, Exit } from "effect"
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

// oxlint-disable-next-line ren/no-comments -- R45: the lookups and the last good commits of one brain are bounded; the oldest goes first.
export const capacity = 1000

// oxlint-disable-next-line ren/no-comments -- R3: one lookup per reference and day for the whole brain. A failed lookup is tried again after a minute and keeps the last good commit until then; a commit in the branch never changes.
export const make = Effect.fnUntraced(function* (
  reader: GitHubReader.Interface,
  options: { readonly refresh: Duration.Input; readonly retry: Duration.Input } = {
    refresh: refreshAfter,
    retry: retryAfter,
  },
) {
  const lastGood = new Map<string, GitHubReader.Lookup>()
  const keyOf = (reference: Reference) => `${reference.repository}#${reference.branch ?? ""}`
  const keep = (reference: Reference, lookup: GitHubReader.Lookup) => {
    lastGood.delete(keyOf(reference))
    lastGood.set(keyOf(reference), lookup)
    const oldest = lastGood.size > capacity ? lastGood.keys().next() : undefined
    if (oldest && !oldest.done) lastGood.delete(oldest.value)
  }
  const cache = yield* Cache.makeWith(
    (reference: Reference) =>
      reader.lookup(reference.repository, reference.branch).pipe(
        Effect.tap((lookup) => Effect.sync(() => keep(reference, lookup))),
        Effect.map((lookup) => ({ lookup, isFresh: true })),
        Effect.catch((error) => {
          const kept = lastGood.get(keyOf(reference))
          return kept
            ? Effect.logWarning(`Keeping the last good lookup of ${reference.repository}: ${error.message}`).pipe(
                Effect.as({ lookup: kept, isFresh: false }),
              )
            : Effect.fail(error)
        }),
      ),
    {
      capacity,
      timeToLive: (exit, reference) => {
        if (Exit.isFailure(exit) || !exit.value.isFresh) return options.retry
        return GitHubReader.commitPattern.test(reference.branch ?? "") ? Duration.infinity : options.refresh
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
