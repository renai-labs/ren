export * as InvitationSchemas from "./schemas.js"

import { Option, Schema, SchemaTransformation } from "effect"

export const Id = Schema.optionalKey(Schema.Unknown).pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transformOptional({
      decode: (value) =>
        Option.some(
          Option.getOrElse(
            Option.filter(value, (id): id is string => typeof id === "string" && id !== ""),
            () => "invalid",
          ),
        ),
      encode: (value) => value,
    }),
  ),
)

export const Join = Schema.optionalKey(Schema.Unknown).pipe(
  Schema.decodeTo(
    Schema.optionalKey(Schema.Literal(true)),
    SchemaTransformation.transformOptional({
      decode: (value) =>
        Option.flatMap(value, (join) =>
          join === true || join === "true" ? Option.some(true as const) : Option.none(),
        ),
      encode: (value) => value,
    }),
  ),
)
