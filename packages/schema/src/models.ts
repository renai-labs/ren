export * as Models from "./models.js"

import { Schema, Struct } from "effect"
import { SearchProvider } from "./search-provider.js"

export interface ApiKey extends Schema.Schema.Type<typeof ApiKey> {}
export const ApiKey = Schema.Struct({
  key: Schema.RedactedFromValue(Schema.NonEmptyString),
  expiresAt: Schema.optionalKey(Schema.DateTimeUtc),
}).annotate({ identifier: "Models.ApiKey" })

export const Protocol = Schema.Literals(["anthropic-messages", "openai-responses", "openai-chat"]).annotate({
  identifier: "Models.Protocol",
})
export type Protocol = typeof Protocol.Type

export const ModelProtocol = Schema.Literals([
  ...Protocol.literals,
  "openai-images",
  "openai-transcription",
  "openai-decisions",
  "openai-speech",
  "openai-realtime",
  "openai-video",
]).annotate({ identifier: "Models.ModelProtocol" })
export type ModelProtocol = typeof ModelProtocol.Type

export const Modality = Schema.Literals(["text", "image", "pdf", "audio", "video"]).annotate({
  identifier: "Models.Modality",
})
export type Modality = typeof Modality.Type

export const Type = Schema.Literals([
  "chat",
  "image",
  "transcription",
  "decision",
  "speech",
  "realtime",
  "video",
]).annotate({ identifier: "Models.Type" })
export type Type = typeof Type.Type

export interface Ref extends Schema.Schema.Type<typeof Ref> {}
export const Ref = Schema.Struct({ providerID: Schema.NonEmptyString, id: Schema.NonEmptyString }).annotate({
  identifier: "Models.Ref",
})

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: Schema.NonEmptyString,
  type: Type,
  name: Schema.optionalKey(Schema.NonEmptyString),
  limit: Schema.optionalKey(
    Schema.Struct({
      context: Schema.Int.check(Schema.isGreaterThan(0)),
      output: Schema.Int.check(Schema.isGreaterThan(0)),
    }),
  ),
  efforts: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  input: Schema.optionalKey(
    Schema.Array(Modality).annotate({ description: "What the model reads. Absent means text only." }),
  ),
  protocol: ModelProtocol,
}).annotate({ identifier: "Models.Info" })

export interface Endpoint extends Schema.Schema.Type<typeof Endpoint> {}
export const Endpoint = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.optionalKey(Schema.NonEmptyString),
  protocol: Protocol,
  baseUrl: Schema.String.check(
    Schema.makeFilter((url) => /^https?:$/u.test(URL.parse(url)?.protocol ?? "") || "an http or https URL"),
  ),
  headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  apiKey: ApiKey,
  models: Schema.Array(Info),
  search: Schema.optionalKey(
    SearchProvider.Providers.annotate({
      description: "The search providers the endpoint serves at `POST {baseUrl}/search`. Absent means none.",
    }),
  ),
}).annotate({ identifier: "Models.Endpoint" })

const uniqueIds = Schema.makeFilter(
  (endpoints: ReadonlyArray<{ readonly id: string }>) =>
    new Set(endpoints.map((endpoint) => endpoint.id)).size === endpoints.length || "endpoint ids are unique",
)

export interface Access extends Schema.Schema.Type<typeof Access> {}
export const Access = Schema.Struct({
  endpoints: Schema.Array(Endpoint).check(uniqueIds),
}).annotate({ identifier: "Models.Access" })

export interface CatalogEndpoint extends Schema.Schema.Type<typeof CatalogEndpoint> {}
export const CatalogEndpoint = Endpoint.mapFields(Struct.omit(["apiKey"])).annotate({
  identifier: "Models.CatalogEndpoint",
  description: "An endpoint without its key.",
})

export interface Catalog extends Schema.Schema.Type<typeof Catalog> {}
export const Catalog = Schema.Struct({
  endpoints: Schema.Array(CatalogEndpoint).check(uniqueIds),
}).annotate({ identifier: "Models.Catalog" })

export const catalog = (access: Access): Catalog => ({
  endpoints: access.endpoints.map((endpoint) => Struct.omit(endpoint, ["apiKey"])),
})

export interface Registration extends Schema.Schema.Type<typeof Registration> {}
export const Registration = Schema.Struct({
  ...Endpoint.mapFields(Struct.pick(["id", "name", "protocol", "baseUrl", "headers"])).fields,
  catalog: Schema.Union([Schema.Literal("inference"), Endpoint.mapFields(Struct.pick(["models", "search"]))]),
}).annotate({ identifier: "Models.Registration" })

export const Providers = Schema.Array(Registration).check(uniqueIds).annotate({ identifier: "Models.Providers" })
export type Providers = typeof Providers.Type

export const registrations = (catalog: Catalog): Providers =>
  catalog.endpoints.map((endpoint) => ({
    ...Struct.omit(endpoint, ["models", "search"]),
    catalog: Struct.pick(endpoint, ["models", "search"]),
  }))

export interface InferenceCatalog extends Schema.Schema.Type<typeof InferenceCatalog> {}
export const InferenceCatalog = Schema.Struct({
  baseUrl: Endpoint.fields.baseUrl,
  models: Schema.Array(Info),
}).annotate({ identifier: "Models.InferenceCatalog" })

export const lookup = (catalog: Catalog) => {
  const models = new Map(
    catalog.endpoints.flatMap((endpoint) =>
      endpoint.models.map((model) => {
        const ref = { providerID: endpoint.id, id: model.id }
        return [JSON.stringify([ref.providerID, ref.id]), { ref, model }] as const
      }),
    ),
  )
  return (ref: Ref) => models.get(JSON.stringify([ref.providerID, ref.id]))
}

export const placeholderKey = "ren:MODELS"

export const personHeader = "ren-member"

export const personLabel = "PERSON"

export const personPlaceholder = (memberId: string) => `ren:${personLabel}.${memberId}`
