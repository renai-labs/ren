export * as ChannelStore from "./channel-store.js"

import { Channel } from "@ren/schema/channel"
import { Context, Effect, Layer, Option, Ref, Schema, Semaphore } from "effect"
import { BrainStorage } from "./brain-storage.js"

const key = "ren:channels"
const Stored = Schema.fromJsonString(Schema.Array(Channel.Provider))

class StorageError extends Schema.TaggedError<StorageError>()("ChannelStore.StorageError", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly current: Effect.Effect<ReadonlyArray<Channel.Provider>>
  readonly save: (channels: ReadonlyArray<Channel.Provider>) => Effect.Effect<boolean, StorageError>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/ChannelStore") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* BrainStorage.Service
    const stored = yield* Effect.tryPromise(() => storage.get(key)).pipe(
      Effect.catch((error) =>
        Effect.logWarning("The channel servers could not be read", error).pipe(Effect.as(undefined)),
      ),
    )
    const current = yield* Ref.make<ReadonlyArray<Channel.Provider>>(
      Option.getOrElse(Schema.decodeUnknownOption(Stored)(stored), () => []),
    )
    const writes = yield* Semaphore.make(1)
    return Service.of({
      current: Ref.get(current),
      save: Effect.fn("ChannelStore.save")((channels) =>
        writes.withPermit(
          Effect.gen(function* () {
            const encoded = Schema.encodeSync(Stored)(channels)
            if (Schema.encodeSync(Stored)(yield* Ref.get(current)) === encoded) return false
            yield* Effect.tryPromise({
              try: () => storage.put(key, encoded),
              catch: () => new StorageError({ message: "The channel servers could not be saved." }),
            })
            yield* Ref.set(current, channels)
            return true
          }),
        ),
      ),
    })
  }),
)
