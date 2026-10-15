export * as ModelStore from "./model-store.js"

import { Models } from "@ren/schema/models"
import { Effect, Option, Schema } from "effect"

const key = "ren:models"

const Stored = Schema.fromJsonString(Schema.toCodecJson(Models.Access))

export interface Storage {
  readonly get: (key: string) => Promise<unknown>
  readonly put: (key: string, value: string) => Promise<void>
  readonly delete: (key: string) => Promise<unknown>
}

export const read = Effect.fn("ModelStore.read")(function* (storage: Storage) {
  const stored = yield* Effect.promise(() => storage.get(key))
  if (!stored) return Option.none<Models.Access>()
  return Option.some(yield* Schema.decodeUnknownEffect(Stored)(stored).pipe(Effect.orDie))
})

export const remove = Effect.fn("ModelStore.remove")(function* (storage: Storage) {
  yield* Effect.promise(() => storage.delete(key))
})

export const write = Effect.fn("ModelStore.write")(function* (storage: Storage, access: Models.Access) {
  const encoded = yield* Schema.encodeEffect(Stored)(access).pipe(Effect.orDie)
  yield* Effect.promise(() => storage.put(key, encoded))
})
