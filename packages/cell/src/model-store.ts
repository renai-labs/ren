export * as ModelStore from "./model-store.js"

import { Models } from "@ren/schema/models"
import { Effect } from "effect"
import { KeyValueStore } from "effect/persistence"

const key = "ren:models"

export interface Storage {
  readonly get: (key: string) => Promise<string | undefined>
  readonly put: (key: string, value: string) => Promise<void>
  readonly delete: (key: string) => Promise<unknown>
}

const store = (storage: Storage) => {
  const get = (key: string) => Effect.promise(() => storage.get(key))
  const remove = (key: string) => Effect.promise(() => storage.delete(key)).pipe(Effect.asVoid)
  return KeyValueStore.toSchemaStore(
    KeyValueStore.makeStringOnly({
      get,
      set: (key, value) => Effect.promise(() => storage.put(key, value)),
      remove,
      clear: remove(key),
      size: get(key).pipe(Effect.map((stored) => (stored ? 1 : 0))),
    }),
    Models.Access,
  )
}

export const read = Effect.fn("ModelStore.read")(function* (storage: Storage) {
  return yield* store(storage).get(key).pipe(Effect.orDie)
})

export const remove = Effect.fn("ModelStore.remove")(function* (storage: Storage) {
  yield* store(storage).remove(key).pipe(Effect.orDie)
})

export const write = Effect.fn("ModelStore.write")(function* (storage: Storage, access: Models.Access) {
  yield* store(storage).set(key, access).pipe(Effect.orDie)
})
