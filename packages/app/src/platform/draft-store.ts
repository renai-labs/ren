export * as DraftStore from "./draft-store.js"

import { Result } from "effect"
import type { Platform } from "./platform.js"

interface Backing {
  readonly length: number
  readonly key: (index: number) => string | null
  readonly getItem: (key: string) => string | null
  readonly setItem: (key: string, value: string) => void
  readonly removeItem: (key: string) => void
}

const quotaNames = new Set(["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"])

const isQuota = (error: unknown) =>
  error instanceof DOMException && (quotaNames.has(error.name) || /quota/i.test(error.message))

export function make(options: {
  readonly storage: Backing | undefined
  readonly prefix: string
  readonly watch?: (handler: (key: string | null) => void) => () => void
}): Platform.Drafts {
  const memory = new Map<string, string>()
  const state = { storage: options.storage }
  const attempt = <A>(use: (storage: Backing) => A): Result.Result<A, unknown> => {
    const storage = state.storage
    if (!storage) return Result.fail(undefined)
    const result = Result.try(() => use(storage))
    if (Result.isFailure(result) && !isQuota(result.failure)) state.storage = undefined
    return result
  }
  const write = (key: string, value: string) => {
    const name = options.prefix + key
    const put = () => attempt((storage) => storage.setItem(name, value))
    const first = put()
    if (Result.isSuccess(first)) return true
    if (!isQuota(first.failure)) return false
    attempt((storage) => storage.removeItem(name))
    if (Result.isSuccess(put())) return true
    return Result.getOrElse(
      attempt((storage) =>
        Array.from({ length: storage.length }, (_, index) => storage.key(index))
          .filter((other): other is string => other !== null && other !== name && other.startsWith(options.prefix))
          .map((other) => ({ name: other, size: storage.getItem(other)?.length ?? 0 }))
          .toSorted((left, right) => right.size - left.size),
      ),
      () => [],
    ).some((other) => Result.isSuccess(attempt((storage) => storage.removeItem(other.name))) && Result.isSuccess(put()))
  }
  const watch = options.watch
  return {
    get: (key) =>
      memory.get(key) ??
      Result.getOrUndefined(attempt((storage) => storage.getItem(options.prefix + key))) ??
      undefined,
    set: (key, value) => {
      if (write(key, value)) memory.delete(key)
      else memory.set(key, value)
    },
    remove: (key) => {
      memory.delete(key)
      attempt((storage) => storage.removeItem(options.prefix + key))
    },
    ...(watch && {
      subscribe: (listener: (key: string) => void) =>
        watch((name) => {
          if (!name?.startsWith(options.prefix)) return
          const key = name.slice(options.prefix.length)
          memory.delete(key)
          listener(key)
        }),
    }),
  }
}
