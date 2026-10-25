export * as Inference from "./inference.js"

import { Models } from "@ren/schema/models"
import { Context, Effect, Layer, Option, Ref, Schema } from "effect"
import { BrainStorage } from "./brain-storage.js"

const baseUrlKey = "ren:inference-url"
const catalogKey = "ren:model-catalog"

const StoredCatalog = Schema.fromJsonString(Models.Catalog)

// oxlint-disable-next-line ren/no-comments -- HR14, HR16: the inference service's URL from the last pull, and the last model list the harness read from it. Both stay in brain storage, so a restart has them before its first pull or read.
export interface Interface {
  readonly baseUrl: Effect.Effect<Option.Option<string>>
  readonly saveBaseUrl: (baseUrl: Option.Option<string>) => Effect.Effect<boolean>
  readonly catalog: Effect.Effect<Option.Option<Models.Catalog>>
  readonly saveCatalog: (catalog: Models.Catalog) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/Inference") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* BrainStorage.Service
    const baseUrl = yield* Ref.make(
      Option.fromNullishOr(yield* Effect.promise(() => storage.get(baseUrlKey))).pipe(Option.filter(Boolean)),
    )
    const catalog = yield* Ref.make(
      Schema.decodeUnknownOption(StoredCatalog)(yield* Effect.promise(() => storage.get(catalogKey))),
    )
    return Service.of({
      baseUrl: Ref.get(baseUrl),
      saveBaseUrl: Effect.fn("Inference.saveBaseUrl")(function* (next) {
        if (Option.getOrUndefined(yield* Ref.get(baseUrl)) === Option.getOrUndefined(next)) return false
        yield* Ref.set(baseUrl, next)
        yield* Effect.promise(() =>
          Option.match(next, {
            onNone: () => storage.delete(baseUrlKey),
            onSome: (url) => storage.put(baseUrlKey, url),
          }),
        )
        return true
      }),
      catalog: Ref.get(catalog),
      saveCatalog: Effect.fn("Inference.saveCatalog")(function* (next) {
        const encoded = Schema.encodeSync(StoredCatalog)(next)
        const previous = Option.map(yield* Ref.get(catalog), Schema.encodeSync(StoredCatalog))
        if (Option.contains(previous, encoded)) return false
        yield* Ref.set(catalog, Option.some(next))
        yield* Effect.promise(() => storage.put(catalogKey, encoded))
        return true
      }),
    })
  }),
)
