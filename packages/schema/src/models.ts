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

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.optionalKey(Schema.NonEmptyString),
  limit: Schema.optionalKey(
    Schema.Struct({
      context: Schema.Int.check(Schema.isGreaterThan(0)),
      output: Schema.Int.check(Schema.isGreaterThan(0)),
    }),
  ),
  efforts: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
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
