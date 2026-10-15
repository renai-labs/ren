export * as ModelStore from "./model-store.js"

import { Models } from "@ren/schema/models"
import { Context, Effect, Layer, Option } from "effect"
import { KeyValueStore } from "effect/persistence"

const accessKey = "ren:models"
const hostTokenKey = "ren:host-token"

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
  readonly readHostToken: Effect.Effect<Option.Option<string>>
  readonly write: (access: Models.Access, hostToken: string | undefined) => Effect.Effect<void>
  readonly removeHostToken: Effect.Effect<void>
  readonly remove: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/ModelStore") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* Storage
    const keys = [accessKey, hostTokenKey]
    const get = (key: string) => Effect.promise(() => storage.get(key))
    const remove = (key: string) => Effect.promise(() => storage.delete(key)).pipe(Effect.asVoid)
    const store = KeyValueStore.makeStringOnly({
      get,
      set: (key, value) => Effect.promise(() => storage.put(key, value)),
      remove,
      clear: Effect.forEach(keys, remove, { discard: true }),
      size: Effect.forEach(keys, get).pipe(Effect.map((values) => values.filter(Boolean).length)),
    })
    const access = KeyValueStore.toSchemaStore(store, Models.Access)
    const removeHostToken = store.remove(hostTokenKey).pipe(Effect.orDie, Effect.withSpan("ModelStore.removeHostToken"))
    return Service.of({
      read: access.get(accessKey).pipe(Effect.orDie, Effect.withSpan("ModelStore.read")),
      readHostToken: store
        .get(hostTokenKey)
        .pipe(Effect.map(Option.fromNullishOr), Effect.orDie, Effect.withSpan("ModelStore.readHostToken")),
      write: Effect.fn("ModelStore.write")(function* (next: Models.Access, hostToken: string | undefined) {
        yield* access.set(accessKey, next).pipe(Effect.orDie)
        if (!hostToken) return yield* removeHostToken
        yield* store.set(hostTokenKey, hostToken).pipe(Effect.orDie)
      }),
      removeHostToken,
      remove: store.clear.pipe(Effect.orDie, Effect.withSpan("ModelStore.remove")),
    })
  }),
)
