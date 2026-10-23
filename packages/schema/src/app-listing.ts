export * as AppListing from "./app-listing.js"

import { Effect, Schema } from "effect"
import { AppIdentity } from "./app/identity.js"
import { Primitive } from "./primitive.js"

export const Categories = Schema.Record(
  Primitive.Slug,
  Schema.Array(Primitive.Slug).check(Schema.isNonEmpty()),
).annotate({
  identifier: "AppListing.Categories",
  description: "Discovery labels by group, such as { roles: [engineer], functions: [research] }.",
})

export interface Input extends Schema.Schema.Type<typeof Input> {}
export const Input = Schema.Struct({
  body: Schema.NullOr(Schema.String)
    .annotate({ description: "The detailed page and setup instructions." })
    .pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
  categories: Categories.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
  examplePrompts: Schema.Array(Schema.NonEmptyString).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
}).annotate({ identifier: "AppListing.Input" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  appId: AppIdentity.ID,
  body: Schema.NullOr(Schema.String),
  categories: Categories,
  examplePrompts: Schema.Array(Schema.String),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "AppListing.Info" })
