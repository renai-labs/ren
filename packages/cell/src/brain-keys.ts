export * as BrainKeys from "./brain-keys.js"

import { Signature } from "@ren/schema/signature"
import { Array, Context, Effect, Layer, Option, Ref, Schema } from "effect"
import { BrainStorage } from "./brain-storage.js"
import { Cell } from "./cell.js"

const key = "ren:public-keys"

const Stored = Schema.fromJsonString(Schema.Array(Signature.PublicKey))

export interface Interface {
  readonly current: Effect.Effect<ReadonlyArray<Signature.PublicKey>>
  readonly save: (keys: ReadonlyArray<Signature.PublicKey>) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/BrainKeys") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* BrainStorage.Service
    const info = yield* Cell.Info
    const stored = yield* Effect.promise(() => storage.get(key)).pipe(
      Effect.map((text) => Option.getOrElse(Schema.decodeUnknownOption(Stored)(text ?? ""), () => [])),
    )
    const merged = (keys: ReadonlyArray<Signature.PublicKey>) =>
      Array.dedupeWith([...keys, ...info.vars.BRAIN_PUBLIC_KEYS], (left, right) => left.id === right.id)
    const current = yield* Ref.make(merged(stored))
    return Service.of({
      current: Ref.get(current),
      save: Effect.fn("BrainKeys.save")(function* (keys) {
        yield* Ref.set(current, merged(keys))
        yield* Effect.promise(() => storage.put(key, Schema.encodeSync(Stored)(keys)))
      }),
    })
  }),
)
