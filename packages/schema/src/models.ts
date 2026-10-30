export * as Models from "./models.js"

import { Schema, Struct } from "effect"

export interface ApiKey extends Schema.Schema.Type<typeof ApiKey> {}
export const ApiKey = Schema.Struct({
  key: Schema.RedactedFromValue(Schema.NonEmptyString),
  expiresAt: Schema.optionalKey(Schema.DateTimeUtc),
}).annotate({ identifier: "Models.ApiKey" })

export const Protocol = Schema.Literals(["anthropic-messages", "openai-responses", "openai-chat"]).annotate({
  identifier: "Models.Protocol",
})
export type Protocol = typeof Protocol.Type

export const Modality = Schema.Literals(["text", "image", "pdf", "audio", "video"]).annotate({
  identifier: "Models.Modality",
})
export type Modality = typeof Modality.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: Schema.NonEmptyString,
  upstreamId: Schema.optionalKey(
    Schema.NonEmptyString.annotate({ description: "The name sent upstream. Defaults to the id." }),
  ),
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
  protocol: Schema.optionalKey(Protocol).annotate({
    description: "The protocol of this model, when it differs from its endpoint’s.",
  }),
}).annotate({ identifier: "Models.Info" })

export interface Endpoint extends Schema.Schema.Type<typeof Endpoint> {}
export const Endpoint = Schema.Struct({
  id: Schema.NonEmptyString,
  protocol: Protocol,
  baseUrl: Schema.String.check(
    Schema.makeFilter((url) => /^https?:$/u.test(URL.parse(url)?.protocol ?? "") || "an http or https URL"),
  ),
  headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  apiKey: ApiKey,
  models: Schema.Array(Info),
}).annotate({ identifier: "Models.Endpoint" })

export interface Access extends Schema.Schema.Type<typeof Access> {}
export const Access = Schema.Struct({
  endpoints: Schema.Array(Endpoint).check(
    Schema.makeFilter(
      (endpoints) =>
        new Set(endpoints.map((endpoint) => endpoint.id)).size === endpoints.length || "endpoint ids are unique",
    ),
  ),
}).annotate({ identifier: "Models.Access" })

export interface Catalog extends Schema.Schema.Type<typeof Catalog> {}
export const Catalog = Schema.Struct({
  endpoints: Schema.Array(
    Endpoint.mapFields(Struct.pick(["id", "protocol", "models"])).annotate({ identifier: "Models.CatalogEndpoint" }),
  ),
}).annotate({ identifier: "Models.Catalog" })

export const catalog = (access: Access): Catalog => ({
  endpoints: access.endpoints.map((endpoint) => Struct.pick(endpoint, ["id", "protocol", "models"])),
})

export const placeholderKey = "ren:MODELS"

export const personHeader = "ren-member"

export const personLabel = "PERSON"

export const personPlaceholder = (memberId: string) => `ren:${personLabel}.${memberId}`

export interface InferenceModelInfo extends Schema.Schema.Type<typeof InferenceModelInfo> {}
export const InferenceModelInfo = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      model_name: Schema.String,
      model_info: Schema.Struct({
        model_key: Schema.optionalKey(Schema.NullOr(Schema.String)),
        provider_key: Schema.optionalKey(Schema.NullOr(Schema.String)),
        display_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
        mode: Schema.optionalKey(Schema.NullOr(Schema.String)),
        hidden: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
        max_input_tokens: Schema.optionalKey(Schema.NullOr(Schema.Number)),
        max_output_tokens: Schema.optionalKey(Schema.NullOr(Schema.Number)),
        modalities: Schema.optionalKey(
          Schema.NullOr(Schema.Struct({ input: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))) })),
        ),
        default_variant: Schema.optionalKey(Schema.NullOr(Schema.String)),
        variants: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Struct({ id: Schema.String })))),
      }),
    }),
  ),
}).annotate({
  identifier: "Models.InferenceModelInfo",
  description: "The body of the inference gateway’s GET /model/info.",
})

export const defaultOutputLimit = 32_000

const isModality = Schema.is(Modality)

const positive = (value: number | null | undefined) =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined

type Entry = InferenceModelInfo["data"][number]

const protocols: Readonly<Record<string, Protocol>> = { anthropic: "anthropic-messages", openai: "openai-responses" }

const endpointProtocol = (endpointId: string) => protocols[endpointId] ?? "openai-chat"

const protocolOf = (found: Entry["model_info"]): Protocol => {
  if (found.provider_key === "anthropic") return "anthropic-messages"
  if (found.mode === "responses") return "openai-responses"
  return "openai-chat"
}

const effortsOf = (found: Entry["model_info"]) => {
  const efforts = (found.variants ?? []).map((variant) => variant.id)
  const preferred = found.default_variant
  if (!preferred || !efforts.includes(preferred)) return efforts
  return [preferred, ...efforts.filter((effort) => effort !== preferred)]
}

const infoOf = (entry: Entry, id: string, inherited: Protocol): Info => {
  const found = entry.model_info
  const protocol = protocolOf(found)
  const context = positive(found.max_input_tokens)
  const efforts = effortsOf(found)
  const input = (found.modalities?.input ?? []).filter(isModality)
  return {
    id,
    ...(id !== entry.model_name && entry.model_name && { upstreamId: entry.model_name }),
    ...(found.display_name && { name: found.display_name }),
    ...(context && { limit: { context, output: positive(found.max_output_tokens) ?? defaultOutputLimit } }),
    input: input.length > 0 ? input : ["text"],
    ...(efforts.length > 0 && { efforts }),
    ...(protocol !== inherited && { protocol }),
  }
}

const chatModes = new Set(["chat", "responses", "completion"])

export const fromInference = (info: InferenceModelInfo): Catalog => {
  const models = info.data.flatMap((entry) => {
    const found = entry.model_info
    if (!found.model_key || !found.provider_key || found.hidden) return []
    if (found.mode && !chatModes.has(found.mode)) return []
    return [
      {
        endpointId: found.provider_key,
        model: infoOf(entry, found.model_key, endpointProtocol(found.provider_key)),
      },
    ]
  })
  const ids = [...new Set(models.map((each) => each.endpointId))].toSorted()
  return {
    endpoints: ids.map((id) => ({
      id,
      protocol: endpointProtocol(id),
      models: [
        ...new Map(
          models.filter((each) => each.endpointId === id).map((each) => [each.model.id, each.model] as const),
        ).values(),
      ].toSorted((left, right) => left.id.localeCompare(right.id)),
    })),
  }
}
