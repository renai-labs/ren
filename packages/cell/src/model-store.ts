export * as ModelStore from "./model-store.js"

import { Models } from "@ren/schema/models"
import { Context, Effect, Layer, type Option } from "effect"
import { KeyValueStore } from "effect/persistence"

const key = "ren:models"

export class Storage extends Context.Service<
  Storage,
  {
    readonly get: (key: string) => Promise<string | undefined>
    readonly put: (key: string, value: string) => Promise<void>
    readonly delete: (key: string) => Promise<unknown>
  }
>()("@ren/cell/ModelStore/Storage") {}

export interface Interface {
  readonly read: Effect.Effect<Option.Option<Models.Access>>
  readonly write: (access: Models.Access) => Effect.Effect<void>
  readonly remove: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/ModelStore") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* Storage
    const get = (key: string) => Effect.promise(() => storage.get(key))
    const remove = (key: string) => Effect.promise(() => storage.delete(key)).pipe(Effect.asVoid)
    const store = KeyValueStore.toSchemaStore(
      KeyValueStore.makeStringOnly({
        get,
        set: (key, value) => Effect.promise(() => storage.put(key, value)),
        remove,
        clear: remove(key),
        size: get(key).pipe(Effect.map((stored) => (stored ? 1 : 0))),
      }),
      Models.Access,
    )
    return Service.of({
      read: store.get(key).pipe(Effect.orDie, Effect.withSpan("ModelStore.read")),
      write: Effect.fn("ModelStore.write")(function* (access: Models.Access) {
        yield* store.set(key, access).pipe(Effect.orDie)
      }),
      remove: store.remove(key).pipe(Effect.orDie, Effect.withSpan("ModelStore.remove")),
    })
  }),
)
