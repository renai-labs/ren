export * as DurableStore from "./durable-store.js"

import { Effect, Layer } from "effect"
import { KeyValueStore } from "effect/persistence"

const deleteLimit = 128

export const layer = (storage: Pick<DurableObjectStorage, "get" | "put" | "delete" | "list">, prefix: string) => {
  const keys = Effect.promise(() => storage.list({ prefix })).pipe(Effect.map((entries) => [...entries.keys()]))
  return Layer.succeed(
    KeyValueStore.KeyValueStore,
    KeyValueStore.makeStringOnly({
      get: (key) => Effect.promise(() => storage.get<string>(`${prefix}${key}`)),
      set: (key, value) => Effect.promise(() => storage.put(`${prefix}${key}`, value)),
      remove: (key) => Effect.promise(() => storage.delete(`${prefix}${key}`)).pipe(Effect.asVoid),
      clear: keys.pipe(
        Effect.flatMap((found) =>
          Effect.forEach(
            Array.from({ length: Math.ceil(found.length / deleteLimit) }, (_, index) =>
              found.slice(index * deleteLimit, (index + 1) * deleteLimit),
            ),
            (batch) => Effect.promise(() => storage.delete(batch)),
            { discard: true },
          ),
        ),
      ),
      size: keys.pipe(Effect.map((found) => found.length)),
    }),
  )
}
