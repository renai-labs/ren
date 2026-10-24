export * as SkillCache from "./cache.js"

import { Cache, Duration, Effect, Exit, MutableHashMap, Option } from "effect"
import type { SkillSource } from "./source.js"

export interface Interface {
  readonly resolve: (pointer: SkillSource.Pointer) => Effect.Effect<SkillSource.Resolved, SkillSource.Failed>
}

const isPinned = (pointer: SkillSource.Pointer) => /^[0-9a-f]{40}$/u.test(pointer.ref ?? "")

// oxlint-disable-next-line ren/no-comments -- One read per source and refresh interval for the whole brain; a failed read keeps the last good one of the same source, and a commit pin never changes.
export const make = Effect.fnUntraced(function* (
  source: SkillSource.Interface,
  options: { readonly refresh: Duration.Input },
) {
  const lastGood = MutableHashMap.empty<SkillSource.Pointer, SkillSource.Resolved>()
  const cache = yield* Cache.makeWith(
    (pointer: SkillSource.Pointer) =>
      source.resolve(pointer).pipe(
        Effect.tap((resolved) => Effect.sync(() => MutableHashMap.set(lastGood, pointer, resolved))),
        Effect.catch((error) => {
          const kept = MutableHashMap.get(lastGood, pointer)
          return Option.isSome(kept)
            ? Effect.logWarning(`Keeping the last good read of ${pointer.url}: ${error.message}`).pipe(
                Effect.as(kept.value),
              )
            : Effect.fail(error)
        }),
      ),
    {
      capacity: Number.MAX_SAFE_INTEGER,
      timeToLive: (exit, pointer) => (Exit.isSuccess(exit) && isPinned(pointer) ? Duration.infinity : options.refresh),
    },
  )
  return {
    resolve: (pointer) =>
      Cache.get(cache, { url: pointer.url, path: pointer.path, ...(pointer.ref && { ref: pointer.ref }) }),
  } satisfies Interface
})
