export * as ModelStore from "./model-store.js"

import { Models } from "@ren/schema/models"
import { Context, Effect, Layer, Option, Result, Schema, SynchronizedRef } from "effect"
import { Base64Url } from "effect/encoding"
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

const Expiry = Schema.fromJsonString(Schema.Struct({ exp: Schema.Int }))

const expiry = (token: string) =>
  Option.fromNullishOr(token.split(".").at(0)).pipe(
    Option.flatMap((part) => Result.getSuccess(Base64Url.decodeString(part))),
    Option.flatMap(Schema.decodeUnknownOption(Expiry)),
    Option.match({ onNone: () => Number.NEGATIVE_INFINITY, onSome: (claims) => claims.exp }),
  )

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
