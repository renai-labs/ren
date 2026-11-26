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

export const Runtime = Schema.Literals(["http", "claude"]).annotate({
  identifier: "Models.Runtime",
  description: "How a brain runs the model: an HTTP call from the harness, or the `claude` program.",
})
export type Runtime = typeof Runtime.Type

export const Method = Schema.Literals(["key", "subscription"]).annotate({
  identifier: "Models.Method",
  description: "How a provider connects: the organization’s own key, or its members’ subscriptions.",
})
export type Method = typeof Method.Type

const Usd = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))

export interface Price extends Schema.Schema.Type<typeof Price> {}
export const Price = Schema.Struct({
  input: Usd,
  output: Usd,
  cacheRead: Schema.optionalKey(Usd),
  cacheWrite: Schema.optionalKey(Usd),
}).annotate({ identifier: "Models.Price", description: "US dollars per 1M tokens, as models.dev states them." })

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
  gateway: Schema.optionalKey(Schema.NonEmptyString).annotate({
    description: "The name the inference service knows the model by. Absent: the id.",
  }),
  runtime: Schema.optionalKey(Runtime).annotate({ description: "Absent: `http`." }),
  price: Schema.optionalKey(Price).annotate({ description: "Absent for a model the organization pays itself." }),
  free: Schema.optionalKey(Schema.Boolean),
  released: Schema.optionalKey(Schema.String).annotate({
    description: "The release date on models.dev, such as `2026-10-02`.",
  }),
  plans: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description: "A subscription model: the organization’s plans that serve it, such as `Max`.",
  }),
  description: Schema.optionalKey(Schema.NonEmptyString).annotate({
    description: "The vendor’s one-line description of the model.",
  }),
  defaultEffort: Schema.optionalKey(Schema.NonEmptyString).annotate({
    description: "The effort a chat starts with, when the vendor names one.",
  }),
  rank: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))).annotate({
    description: "The vendor’s order of its models, 1 first. Absent: the vendor does not order them.",
  }),
  featured: Schema.optionalKey(Schema.Literal(true)).annotate({
    description: "One of the models the vendor shows first; a picker puts the others behind “More models”.",
  }),
  client: Schema.optionalKey(
    Schema.Struct({
      effortUpdates: Schema.optionalKey(Schema.Boolean).annotate({
        description: "False: the effort is set at start only.",
      }),
      compaction: Schema.optionalKey(Schema.Literals(["summary"])),
      cost: Schema.optionalKey(Schema.Boolean).annotate({ description: "False: the client shows no cost." }),
    }),
  ).annotate({
    description: "Client settings a brain applies to the model, such as those of a ChatGPT seat (providers §7.2).",
  }),
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
  // oxlint-disable-next-line ren/no-comments -- D4: the header the endpoint reads a brain's key from (`Bearer <key>`) when a program sends its own login in Authorization, as the `claude` runtime does. The inference plugin names it.
  keyHeader: Schema.optionalKey(Schema.NonEmptyString),
  method: Schema.optionalKey(Method),
  apiKey: ApiKey,
  models: Schema.Array(Info),
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
  ...Endpoint.mapFields(Struct.pick(["id", "name", "protocol", "baseUrl", "headers", "method"])).fields,
  catalog: Endpoint.mapFields(Struct.pick(["models"])),
}).annotate({ identifier: "Models.Registration" })

export const Providers = Schema.Array(Registration).check(uniqueIds).annotate({ identifier: "Models.Providers" })
export type Providers = typeof Providers.Type

export const registrations = (catalog: Catalog): Providers =>
  catalog.endpoints.map((endpoint) => ({
    ...Struct.omit(endpoint, ["models"]),
    catalog: Struct.pick(endpoint, ["models"]),
  }))

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
