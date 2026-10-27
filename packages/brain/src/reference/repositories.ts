export * as Repositories from "./repositories.js"

import type { GitHost } from "@ren/schema/git-host"
import type { Reference } from "@ren/schema/reference"
import { Cache, Duration, Effect, Equal, Exit, Ref, type Scope, Semaphore } from "effect"
import { GitHosts } from "../git/hosts.js"
import { LsRefs } from "../git/ls-refs.js"

export interface Key {
  readonly repository: string
  readonly branch?: string
}

// oxlint-disable-next-line ren/no-comments -- R52: a reference that the brain can copy, with its path below the root, or one that it cannot, with the reason.
export type Prepared =
  | {
      readonly type: "ready"
      readonly info: Reference.Info
      readonly path: string
      readonly archive: GitHosts.Archive
    }
  | { readonly type: "unavailable"; readonly info: Reference.Info; readonly unavailable: GitHost.Unavailable }

export interface Chat {
  readonly prepared: () => ReadonlyArray<Prepared>
  // oxlint-disable-next-line ren/no-comments -- R36: starts a lookup in the background and returns at once.
  readonly refresh: Effect.Effect<void>
  // oxlint-disable-next-line ren/no-comments -- R37: looks up, after any lookup that runs, so a prompt sees the current references.
  readonly ready: Effect.Effect<void>
}

export interface Interface {
  readonly resolve: (key: Key) => Effect.Effect<GitHosts.Lookup, GitHosts.Failed>
  readonly chat: (input: {
    readonly references: Effect.Effect<ReadonlyArray<Reference.Info>>
    readonly changed: Effect.Effect<void>
  }) => Effect.Effect<Chat, never, Scope.Scope>
}

export const refreshAfter = Duration.days(1)

export const retryAfter = Duration.minutes(1)

// oxlint-disable-next-line ren/no-comments -- R45: the lookups and the last good commits of one brain are bounded; the oldest goes first.
export const capacity = 1000

const keyOf = (key: Key) => `${key.repository}#${key.branch ?? ""}`

// oxlint-disable-next-line ren/no-comments -- R3: one lookup per reference and day for the whole brain. A failed lookup is tried again after a minute and keeps the last good commit until then; a commit in the branch never changes.
export const make = Effect.fnUntraced(function* (
  hosts: GitHosts.Interface,
  options: { readonly refresh: Duration.Input; readonly retry: Duration.Input } = {
    refresh: refreshAfter,
    retry: retryAfter,
  },
) {
  const lastGood = new Map<string, GitHosts.Lookup>()
  const keep = (key: Key, lookup: GitHosts.Lookup) => {
    lastGood.delete(keyOf(key))
    lastGood.set(keyOf(key), lookup)
    const oldest = lastGood.size > capacity ? lastGood.keys().next() : undefined
    if (oldest && !oldest.done) lastGood.delete(oldest.value)
  }
  const cache = yield* Cache.makeWith(
    (key: Key) =>
      hosts.lookup(key.repository, key.branch).pipe(
        Effect.tap((lookup) => Effect.sync(() => keep(key, lookup))),
        Effect.map((lookup) => ({ lookup, isFresh: true })),
        Effect.catch((error) => {
          const kept = lastGood.get(keyOf(key))
          return kept
            ? Effect.logWarning(`Keeping the last good lookup of ${key.repository}: ${error.message}`).pipe(
                Effect.as({ lookup: kept, isFresh: false }),
              )
            : Effect.fail(error)
        }),
      ),
    {
      capacity,
      timeToLive: (exit, key) => {
        if (Exit.isFailure(exit) || !exit.value.isFresh) return options.retry
        return LsRefs.commitPattern.test(key.branch ?? "") ? Duration.infinity : options.refresh
      },
    },
  )
  const resolve = (key: Key) =>
    Cache.get(cache, { repository: key.repository, ...(key.branch && { branch: key.branch }) }).pipe(
      Effect.map((entry) => entry.lookup),
    )
  const prepare = (references: ReadonlyArray<Reference.Info>) =>
    Effect.forEach(
      references,
      (info) =>
        resolve({ repository: info.repository, ...(info.branch && { branch: info.branch }) }).pipe(
          Effect.map((lookup): Prepared => ({
            type: "ready",
            info,
            path: `${lookup.repository.host}/${GitHosts.nameOf(lookup.repository)}/${lookup.commit.slice(0, 12)}`,
            archive: lookup.archive,
          })),
          Effect.catch((error) =>
            Effect.succeed<Prepared>({
              type: "unavailable",
              info,
              unavailable: {
                reason: error.reason,
                name: error.name,
                ...(error.detail && { detail: error.detail }),
              },
            }),
          ),
        ),
      { concurrency: 8 },
    )
  return {
    resolve,
    chat: Effect.fnUntraced(function* (input) {
      const current = yield* Ref.make<ReadonlyArray<Prepared>>([])
      const lookups = yield* Semaphore.make(1)
      // oxlint-disable-next-line ren/no-comments -- R36, R37: one lookup at a time for the chat. The start and a settings change look up in the background; a prompt waits.
      const lookUp = lookups.withPermit(
        Effect.gen(function* () {
          const next = yield* prepare(yield* input.references)
          if (Equal.equals(next, yield* Ref.get(current))) return
          yield* Ref.set(current, next)
          yield* input.changed
        }),
      )
      const refresh = Effect.asVoid(Effect.forkIn(lookUp, yield* Effect.scope))
      yield* refresh
      return { prepared: () => Ref.getUnsafe(current), refresh, ready: lookUp } satisfies Chat
    }),
  } satisfies Interface
})
