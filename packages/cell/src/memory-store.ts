export * as MemoryStore from "./memory-store.js"

import { PullMemory } from "@ren/host-api/ren-host-api"
import { Context, Effect, Layer, Option, Ref, Schema, Semaphore } from "effect"
import { BrainStorage } from "./brain-storage.js"

const key = "ren:memory"
const Stored = Schema.fromJsonString(PullMemory)

class StorageError extends Schema.TaggedError<StorageError>()("MemoryStore.StorageError", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly current: Effect.Effect<Option.Option<PullMemory>>
  readonly save: (memory: PullMemory) => Effect.Effect<boolean, StorageError>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/MemoryStore") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* BrainStorage.Service
    const stored = yield* Effect.tryPromise(() => storage.get(key)).pipe(
      Effect.catch((error) => Effect.logWarning("The memory could not be read", error).pipe(Effect.as(undefined))),
    )
    const current = yield* Ref.make(Schema.decodeUnknownOption(Stored)(stored))
    const writes = yield* Semaphore.make(1)
    return Service.of({
      current: Ref.get(current),
      save: Effect.fn("MemoryStore.save")((memory) =>
        writes.withPermit(
          Effect.gen(function* () {
            const encoded = Schema.encodeSync(Stored)(memory)
            if (Option.contains(Option.map(yield* Ref.get(current), Schema.encodeSync(Stored)), encoded)) return false
            yield* Effect.tryPromise({
              try: () => storage.put(key, encoded),
              catch: () => new StorageError({ message: "The memory could not be saved." }),
            })
            yield* Ref.set(current, Option.some(memory))
            return true
          }),
        ),
      ),
    })
  }),
)
