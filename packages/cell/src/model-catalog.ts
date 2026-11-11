export * as ModelCatalog from "./model-catalog.js"

import { Models } from "@ren/schema/models"
import { Array, Context, Effect, Equal, Layer, Option, Schema, Struct, SynchronizedRef } from "effect"
import { BrainStorage } from "./brain-storage.js"
import type { Harness } from "./harness/harness.js"

const catalogKey = "ren:model-catalog"

const Stored = Schema.fromJsonString(
  Schema.Struct({ providers: Models.Providers, catalog: Schema.OptionFromNullOr(Models.Catalog) }),
)

export interface Snapshot {
  readonly generation: number
  readonly providers: Models.Providers
  readonly catalog: Option.Option<Models.Catalog>
}

export interface Interface {
  readonly snapshot: Effect.Effect<Snapshot>
  readonly current: Effect.Effect<Option.Option<Models.Catalog>>
  readonly save: (catalog: Models.Catalog) => Effect.Effect<boolean>
  readonly register: (providers: Models.Providers) => Effect.Effect<boolean>
  readonly update: (
    generation: number,
    id: string,
    fields: Partial<Pick<Models.CatalogEndpoint, "models" | "search">>,
  ) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/ModelCatalog") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* BrainStorage.Service
    const saved = Schema.decodeUnknownOption(Stored)(yield* Effect.promise(() => storage.get(catalogKey)))
    const state = yield* SynchronizedRef.make<Snapshot>({
      generation: 0,
      ...Option.getOrElse(saved, () => ({ providers: [], catalog: Option.none<Models.Catalog>() })),
    })
    return Service.of({
      snapshot: SynchronizedRef.get(state),
      current: Effect.map(SynchronizedRef.get(state), (state) => state.catalog),
      save: Effect.fn("ModelCatalog.save")((next) =>
        SynchronizedRef.modifyEffect(state, (current) =>
          Effect.gen(function* () {
            const updated = { ...current, catalog: Option.some(next) }
            const encoded = Schema.encodeSync(Stored)(updated)
            if (encoded === Schema.encodeSync(Stored)(current)) return [false, current] as const
            yield* Effect.promise(() => storage.put(catalogKey, encoded))
            return [true, updated] as const
          }),
        ),
      ),
      register: Effect.fn("ModelCatalog.register")((providers) =>
        SynchronizedRef.modifyEffect(state, (current) =>
          Effect.gen(function* () {
            if (Equal.equals(providers, current.providers)) return [false, current] as const
            const endpoints = providers.flatMap((provider): ReadonlyArray<Models.CatalogEndpoint> => {
              if (provider.catalog !== "inference")
                return [{ ...Struct.omit(provider, ["catalog"]), ...provider.catalog }]
              if (!current.providers.some((prior) => Equal.equals(prior, provider))) return []
              return (
                Option.getOrUndefined(current.catalog)?.endpoints.filter((endpoint) => endpoint.id === provider.id) ??
                []
              )
            })
            const updated = { generation: current.generation + 1, providers, catalog: Option.some({ endpoints }) }
            yield* Effect.promise(() => storage.put(catalogKey, Schema.encodeSync(Stored)(updated)))
            return [true, updated] as const
          }),
        ),
      ),
      update: Effect.fn("ModelCatalog.update")((generation, id, fields) =>
        SynchronizedRef.updateEffect(state, (current) =>
          Effect.gen(function* () {
            if (current.generation !== generation) return current
            const provider = current.providers.find((provider) => provider.id === id)
            if (!provider) return current
            const previous = Option.getOrUndefined(current.catalog)?.endpoints ?? []
            const endpoint = previous.find((endpoint) => endpoint.id === id)
            const updated = {
              ...current,
              catalog: Option.some({
                endpoints: current.providers.flatMap((provider) => {
                  if (provider.id === id)
                    return [{ ...Struct.omit(provider, ["catalog"]), models: [], ...endpoint, ...fields }]
                  return previous.filter((endpoint) => endpoint.id === provider.id)
                }),
              }),
            }
            const encoded = Schema.encodeSync(Stored)(updated)
            if (encoded === Schema.encodeSync(Stored)(current)) return current
            yield* Effect.promise(() => storage.put(catalogKey, encoded))
            return updated
          }),
        ),
      ),
    })
  }),
)

export const endpoints = Effect.fnUntraced(function* (catalog: Models.Catalog, keyFor: Harness.Refresh) {
  return yield* Effect.forEach(catalog.endpoints, (endpoint) =>
    Effect.map(
      keyFor(endpoint.id),
      Option.map((apiKey): Models.Endpoint => Struct.assign(endpoint, { apiKey })),
    ),
  ).pipe(Effect.map(Array.getSomes))
})
