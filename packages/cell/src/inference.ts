export * as Inference from "./inference.js"

import { Models } from "@ren/schema/models"
import { ModelTypes } from "@ren/schema/model-types"
import { Context, Effect, Layer, Option, Schema, SynchronizedRef } from "effect"
import { BrainStorage } from "./brain-storage.js"

const baseUrlKey = "ren:inference-url"
const catalogKey = "ren:model-catalog"
const modelCatalogsKey = "ren:model-type-catalogs"

const StoredCatalog = Schema.fromJsonString(Models.Catalog)
const StoredCatalogs = Schema.fromJsonString(ModelTypes.Catalogs)

export interface Snapshot {
  readonly revision: number
  readonly generation: number
  readonly baseUrl: Option.Option<string>
  readonly catalog: Option.Option<Models.Catalog>
  readonly modelCatalogs: ModelTypes.Catalogs
}

type Source = Pick<Snapshot, "generation" | "baseUrl">

export interface Interface {
  readonly snapshot: Effect.Effect<Snapshot>
  readonly publish: (snapshot: Snapshot, install: Effect.Effect<void>) => Effect.Effect<boolean>
  readonly baseUrl: Effect.Effect<Option.Option<string>>
  readonly saveBaseUrl: (baseUrl: Option.Option<string>) => Effect.Effect<boolean>
  readonly catalog: Effect.Effect<Option.Option<Models.Catalog>>
  readonly saveCatalog: (catalog: Models.Catalog, source?: Source) => Effect.Effect<boolean>
  readonly modelCatalogs: Effect.Effect<ModelTypes.Catalogs>
  readonly saveModelCatalogs: (catalogs: ModelTypes.Catalogs, source?: Source) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/Inference") {}

const currentSource = (snapshot: Snapshot, source: Source | undefined) =>
  !source ||
  (snapshot.generation === source.generation &&
    Option.getOrUndefined(snapshot.baseUrl) === Option.getOrUndefined(source.baseUrl))

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* BrainStorage.Service
    const state = yield* SynchronizedRef.make<Snapshot>({
      revision: 0,
      generation: 0,
      baseUrl: Option.fromNullishOr(yield* Effect.promise(() => storage.get(baseUrlKey))).pipe(Option.filter(Boolean)),
      catalog: Schema.decodeUnknownOption(StoredCatalog)(yield* Effect.promise(() => storage.get(catalogKey))),
      modelCatalogs: Option.getOrElse(
        Schema.decodeUnknownOption(StoredCatalogs)(yield* Effect.promise(() => storage.get(modelCatalogsKey))),
        () => ({}),
      ),
    })
    const snapshot = SynchronizedRef.get(state)
    return Service.of({
      snapshot,
      publish: Effect.fn("Inference.publish")((expected, install) =>
        SynchronizedRef.modifyEffect(state, (current) =>
          expected.revision === current.revision
            ? Effect.as(install, [true, current] as const)
            : Effect.succeed([false, current] as const),
        ),
      ),
      baseUrl: Effect.map(snapshot, (current) => current.baseUrl),
      saveBaseUrl: Effect.fn("Inference.saveBaseUrl")((next) =>
        SynchronizedRef.modifyEffect(state, (current) =>
          Effect.gen(function* () {
            if (Option.getOrUndefined(current.baseUrl) === Option.getOrUndefined(next)) return [false, current] as const
            yield* Effect.promise(() =>
              Option.match(next, {
                onNone: () => storage.delete(baseUrlKey),
                onSome: (url) => storage.put(baseUrlKey, url),
              }),
            )
            return [
              true,
              { ...current, baseUrl: next, revision: current.revision + 1, generation: current.generation + 1 },
            ] as const
          }),
        ),
      ),
      catalog: Effect.map(snapshot, (current) => current.catalog),
      saveCatalog: Effect.fn("Inference.saveCatalog")((next, source) =>
        SynchronizedRef.modifyEffect(state, (current) =>
          Effect.gen(function* () {
            if (!currentSource(current, source)) return [false, current] as const
            const encoded = Schema.encodeSync(StoredCatalog)(next)
            if (Option.contains(Option.map(current.catalog, Schema.encodeSync(StoredCatalog)), encoded))
              return [false, current] as const
            yield* Effect.promise(() => storage.put(catalogKey, encoded))
            return [true, { ...current, catalog: Option.some(next), revision: current.revision + 1 }] as const
          }),
        ),
      ),
      modelCatalogs: Effect.map(snapshot, (current) => current.modelCatalogs),
      saveModelCatalogs: Effect.fn("Inference.saveModelCatalogs")((patch, source) =>
        SynchronizedRef.modifyEffect(state, (current) =>
          Effect.gen(function* () {
            if (!currentSource(current, source)) return [false, current] as const
            const next = { ...current.modelCatalogs, ...patch }
            const encoded = Schema.encodeSync(StoredCatalogs)(next)
            if (encoded === Schema.encodeSync(StoredCatalogs)(current.modelCatalogs)) return [false, current] as const
            yield* Effect.promise(() => storage.put(modelCatalogsKey, encoded))
            return [true, { ...current, modelCatalogs: next, revision: current.revision + 1 }] as const
          }),
        ),
      ),
    })
  }),
)
