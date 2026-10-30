export * as Inference from "./inference.js"

import { Models } from "@ren/schema/models"
import { ModelTypes } from "@ren/schema/model-types"
import { Context, Effect, Layer, Option, Ref, Schema, Semaphore } from "effect"
import { BrainStorage } from "./brain-storage.js"

const baseUrlKey = "ren:inference-url"
const catalogKey = "ren:model-catalog"
const modelCatalogsKey = "ren:model-type-catalogs"

const StoredCatalog = Schema.fromJsonString(Models.Catalog)
const StoredCatalogs = Schema.fromJsonString(ModelTypes.Catalogs)

// oxlint-disable-next-line ren/no-comments -- HR14, HR16: the inference service's URL from the last pull, and the last model list the harness read from it. Both stay in brain storage, so a restart has them before its first pull or read.
export interface Interface {
  readonly baseUrl: Effect.Effect<Option.Option<string>>
  readonly saveBaseUrl: (baseUrl: Option.Option<string>) => Effect.Effect<boolean>
  readonly catalog: Effect.Effect<Option.Option<Models.Catalog>>
  readonly saveCatalog: (catalog: Models.Catalog, source?: { readonly baseUrl: string }) => Effect.Effect<boolean>
  readonly modelCatalogs: Effect.Effect<ModelTypes.Catalogs>
  readonly saveModelCatalogs: (
    catalogs: ModelTypes.Catalogs,
    source?: { readonly baseUrl: string },
  ) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/Inference") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* BrainStorage.Service
    const writing = yield* Semaphore.make(1)
    const baseUrl = yield* Ref.make(
      Option.fromNullishOr(yield* Effect.promise(() => storage.get(baseUrlKey))).pipe(Option.filter(Boolean)),
    )
    const catalog = yield* Ref.make(
      Schema.decodeUnknownOption(StoredCatalog)(yield* Effect.promise(() => storage.get(catalogKey))),
    )
    const modelCatalogs = yield* Ref.make(
      Option.getOrElse(
        Schema.decodeUnknownOption(StoredCatalogs)(yield* Effect.promise(() => storage.get(modelCatalogsKey))),
        () => ({}),
      ),
    )
    return Service.of({
      baseUrl: Ref.get(baseUrl),
      saveBaseUrl: Effect.fn("Inference.saveBaseUrl")(
        function* (next) {
          if (Option.getOrUndefined(yield* Ref.get(baseUrl)) === Option.getOrUndefined(next)) return false
          yield* Ref.set(baseUrl, next)
          yield* Effect.promise(() =>
            Option.match(next, {
              onNone: () => storage.delete(baseUrlKey),
              onSome: (url) => storage.put(baseUrlKey, url),
            }),
          )
          return true
        },
        (effect) => writing.withPermit(effect),
      ),
      catalog: Ref.get(catalog),
      saveCatalog: Effect.fn("Inference.saveCatalog")(
        function* (next, source) {
          if (source && source.baseUrl !== Option.getOrUndefined(yield* Ref.get(baseUrl))) return false
          const encoded = Schema.encodeSync(StoredCatalog)(next)
          const previous = Option.map(yield* Ref.get(catalog), Schema.encodeSync(StoredCatalog))
          if (Option.contains(previous, encoded)) return false
          yield* Ref.set(catalog, Option.some(next))
          yield* Effect.promise(() => storage.put(catalogKey, encoded))
          return true
        },
        (effect) => writing.withPermit(effect),
      ),
      modelCatalogs: Ref.get(modelCatalogs),
      saveModelCatalogs: Effect.fn("Inference.saveModelCatalogs")(
        function* (patch, source) {
          if (source && source.baseUrl !== Option.getOrUndefined(yield* Ref.get(baseUrl))) return false
          const previous = yield* Ref.get(modelCatalogs)
          const next = { ...previous, ...patch }
          const encoded = Schema.encodeSync(StoredCatalogs)(next)
          if (encoded === Schema.encodeSync(StoredCatalogs)(previous)) return false
          yield* Effect.promise(() => storage.put(modelCatalogsKey, encoded))
          yield* Ref.set(modelCatalogs, next)
          return true
        },
        (effect) => writing.withPermit(effect),
      ),
    })
  }),
)
