export * as AppStore from "./app-store.js"

import { AppCatalog } from "@ren/schema/app-catalog"
import { Context, Effect, Layer, Option, Ref, Schema, Semaphore } from "effect"
import { BrainStorage } from "./brain-storage.js"

const key = "ren:apps"
const Stored = Schema.fromJsonString(AppCatalog.Info)

class StorageError extends Schema.TaggedError<StorageError>()("AppStore.StorageError", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly current: Effect.Effect<Option.Option<AppCatalog.Info>>
  readonly save: (info: AppCatalog.Info) => Effect.Effect<boolean, StorageError>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/AppStore") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* BrainStorage.Service
    const stored = yield* Effect.tryPromise(() => storage.get(key)).pipe(
      Effect.catch((error) => Effect.logWarning("The app catalog could not be read", error).pipe(Effect.as(undefined))),
    )
    const current = yield* Ref.make(Schema.decodeUnknownOption(Stored)(stored))
    const writes = yield* Semaphore.make(1)
    return Service.of({
      current: Ref.get(current),
      save: Effect.fn("AppStore.save")((info) =>
        writes.withPermit(
          Effect.gen(function* () {
            const encoded = Schema.encodeSync(Stored)(info)
            if (Option.contains(Option.map(yield* Ref.get(current), Schema.encodeSync(Stored)), encoded)) return false
            yield* Effect.tryPromise({
              try: () => storage.put(key, encoded),
              catch: () => new StorageError({ message: "The app catalog could not be saved." }),
            })
            yield* Ref.set(current, Option.some(info))
            return true
          }),
        ),
      ),
    })
  }),
)
