export * as ModelStore from "./model-store.js"

import { BrainToken } from "@ren/host-api/brain-token"
import { Models } from "@ren/schema/models"
import { Context, Effect, Layer, Option, SynchronizedRef } from "effect"
import { KeyValueStore } from "effect/persistence"
import { BrainStorage } from "./brain-storage.js"

const accessKey = "ren:models"
const hashKey = "ren:models-hash"
const hostTokenKey = "ren:host-token"

export interface Interface {
  readonly read: Effect.Effect<Option.Option<Models.Access>>
  readonly hash: Effect.Effect<Option.Option<string>>
  readonly install: (access: Models.Access, hash: string) => Effect.Effect<void>
  readonly forget: Effect.Effect<void>
  readonly readHostToken: Effect.Effect<Option.Option<string>>
  readonly write: (access: Models.Access, hostToken: string | undefined) => Effect.Effect<void>
  readonly writeIfUnchanged: (
    sent: string,
    access: Models.Access,
    hostToken: string | undefined,
  ) => Effect.Effect<boolean>
  readonly writeHostTokenIfUnchanged: (sent: string, hostToken: string) => Effect.Effect<boolean>
  readonly keepHostToken: (hostToken: string) => Effect.Effect<void>
  readonly removeHostTokenIfUnchanged: (sent: string) => Effect.Effect<void>
  readonly remove: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/ModelStore") {}

const expiry = (token: string) => Option.getOrElse(BrainToken.expiry(token), () => Number.NEGATIVE_INFINITY)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* BrainStorage.Service
    const keys = [accessKey, hashKey, hostTokenKey]
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
    const storedHostToken = yield* SynchronizedRef.make(
      yield* store.get(hostTokenKey).pipe(Effect.map(Option.fromNullishOr), Effect.orDie),
    )
    const put = (next: Models.Access, hostToken: string | undefined) =>
      access
        .set(accessKey, next)
        .pipe(
          Effect.andThen(hostToken ? store.set(hostTokenKey, hostToken) : store.remove(hostTokenKey)),
          Effect.orDie,
          Effect.as(Option.fromNullishOr(hostToken)),
        )
    return Service.of({
      read: access.get(accessKey).pipe(Effect.orDie, Effect.withSpan("ModelStore.read")),
      hash: store.get(hashKey).pipe(Effect.map(Option.fromNullishOr), Effect.orDie),
      install: Effect.fn("ModelStore.install")(function* (next: Models.Access, hash: string) {
        yield* access.set(accessKey, next).pipe(Effect.andThen(store.set(hashKey, hash)), Effect.orDie)
      }),
      forget: store.remove(hashKey).pipe(Effect.orDie),
      readHostToken: SynchronizedRef.get(storedHostToken).pipe(Effect.withSpan("ModelStore.readHostToken")),
      write: Effect.fn("ModelStore.write")(function* (next: Models.Access, hostToken: string | undefined) {
        yield* SynchronizedRef.updateEffect(storedHostToken, () => put(next, hostToken))
      }),
      writeIfUnchanged: Effect.fn("ModelStore.writeIfUnchanged")(function* (
        sent: string,
        next: Models.Access,
        hostToken: string | undefined,
      ) {
        return yield* SynchronizedRef.modifyEffect(storedHostToken, (stored) =>
          Option.contains(stored, sent)
            ? put(next, hostToken).pipe(Effect.map((saved) => [true, saved] as const))
            : Effect.succeed([false, stored] as const),
        )
      }),
      writeHostTokenIfUnchanged: Effect.fn("ModelStore.writeHostTokenIfUnchanged")(function* (
        sent: string,
        hostToken: string,
      ) {
        return yield* SynchronizedRef.modifyEffect(storedHostToken, (stored) =>
          Option.contains(stored, sent)
            ? store.set(hostTokenKey, hostToken).pipe(Effect.orDie, Effect.as([true, Option.some(hostToken)] as const))
            : Effect.succeed([false, stored] as const),
        )
      }),
      keepHostToken: Effect.fn("ModelStore.keepHostToken")(function* (hostToken: string) {
        yield* SynchronizedRef.updateEffect(storedHostToken, (stored) =>
          Option.exists(stored, (current) => expiry(current) >= expiry(hostToken))
            ? Effect.succeed(stored)
            : store.set(hostTokenKey, hostToken).pipe(Effect.orDie, Effect.as(Option.some(hostToken))),
        )
      }),
      removeHostTokenIfUnchanged: Effect.fn("ModelStore.removeHostTokenIfUnchanged")(function* (sent: string) {
        yield* SynchronizedRef.updateEffect(storedHostToken, (stored) =>
          Option.contains(stored, sent)
            ? store.remove(hostTokenKey).pipe(Effect.orDie, Effect.as(Option.none()))
            : Effect.succeed(stored),
        )
      }),
      remove: SynchronizedRef.updateEffect(storedHostToken, () =>
        store.clear.pipe(Effect.orDie, Effect.as(Option.none())),
      ).pipe(Effect.withSpan("ModelStore.remove")),
    })
  }),
)
