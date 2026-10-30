export * as ModelTypes from "./model-types.js"

import { Schema } from "effect"
import { Models } from "./models.js"

export const Type = Schema.Literals([
  "image_generation",
  "audio_transcription",
  "decisions",
  "search",
  "video_generation",
]).annotate({ identifier: "ModelTypes.Type" })
export type Type = typeof Type.Type

export interface Model extends Schema.Schema.Type<typeof Model> {}
export const Model = Schema.Struct({
  id: Schema.NonEmptyString,
  upstreamId: Schema.optionalKey(Schema.NonEmptyString),
  name: Schema.optionalKey(Schema.NonEmptyString),
}).annotate({ identifier: "ModelTypes.Model" })

export interface ModelRef extends Schema.Schema.Type<typeof ModelRef> {}
export const ModelRef = Schema.Struct({
  providerId: Schema.NonEmptyString,
  modelId: Schema.NonEmptyString,
}).annotate({ identifier: "ModelTypes.ModelRef" })

export const Defaults = Schema.Record(Type, Schema.optionalKey(ModelRef)).annotate({
  identifier: "ModelTypes.Defaults",
})
export type Defaults = typeof Defaults.Type

export interface Catalog extends Schema.Schema.Type<typeof Catalog> {}
export const Catalog = Schema.Struct({
  providerId: Schema.NonEmptyString,
  models: Schema.Array(Model).check(
    Schema.makeFilter(
      (models) => new Set(models.map((model) => model.id)).size === models.length || "model ids are unique",
    ),
  ),
}).annotate({ identifier: "ModelTypes.Catalog" })

export const Catalogs = Schema.Record(Type, Schema.optionalKey(Catalog)).annotate({
  identifier: "ModelTypes.Catalogs",
})
export type Catalogs = typeof Catalogs.Type

export interface Provider extends Schema.Schema.Type<typeof Provider> {}
export const Provider = Schema.Struct({
  id: Schema.NonEmptyString,
  baseUrl: Models.Endpoint.fields.baseUrl,
  headers: Models.Endpoint.fields.headers,
  apiKey: Models.ApiKey,
}).annotate({ identifier: "ModelTypes.Provider" })

export const Providers = Schema.Record(Type, Schema.optionalKey(Provider)).annotate({
  identifier: "ModelTypes.Providers",
})
export type Providers = typeof Providers.Type

const renTypes = ["image_generation", "audio_transcription", "decisions"] as const

export interface SearchInfo extends Schema.Schema.Type<typeof SearchInfo> {}
export const SearchInfo = Schema.Struct({
  data: Schema.Array(Schema.Struct({ search_tool_name: Schema.NonEmptyString })),
}).annotate({ identifier: "ModelTypes.SearchInfo" })

export const fromInference = (info: Models.InferenceModelInfo): Catalogs =>
  Object.fromEntries(
    renTypes.map((type) => [
      type,
      {
        providerId: "ren",
        models: [
          ...new Map(
            info.data.flatMap((entry) => {
              const found = entry.model_info
              if (found.mode !== type || found.hidden || !found.model_key || !found.provider_key) return []
              const model: Model = {
                id: `${found.provider_key}/${found.model_key}`,
                upstreamId: entry.model_name,
                ...(found.display_name && { name: found.display_name }),
              }
              return [[model.id, model] as const]
            }),
          ).values(),
        ].toSorted((left, right) => left.id.localeCompare(right.id)),
      },
    ]),
  )

export const fromSearch = (search: SearchInfo): Catalog => ({
  providerId: "ren",
  models: [...new Set(search.data.map((entry) => entry.search_tool_name).filter(Boolean))]
    .toSorted()
    .map((id) => ({ id, upstreamId: id })),
})
