export * as AppRegistry from "./app-registry.js"

import { Schema } from "effect"
import { App } from "./app.js"
import { AppListing } from "./app-listing.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Skill } from "./skill.js"

export interface Publication extends Schema.Schema.Type<typeof Publication> {}
export const Publication = Schema.Struct({
  ...App.Declaration.fields,
  slug: Primitive.Slug,
  expectedRevision: Schema.optionalKey(
    Schema.Int.annotate({ description: "Publish only while the app’s definition is still at this revision." }),
  ),
  listing: Schema.optionalKey(
    AppListing.Input.annotate({ description: "Omit to leave the app’s listing, or its absence, unchanged." }),
  ),
}).annotate({ identifier: "AppRegistry.Publication" })

export interface Batch extends Schema.Schema.Type<typeof Batch> {}
export const Batch = Schema.Struct({
  apps: Schema.Array(Publication).check(
    Schema.makeFilter(
      (apps) => new Set(apps.map((app) => app.slug)).size === apps.length || "Each app slug appears once in a batch.",
    ),
  ),
}).annotate({ identifier: "AppRegistry.Batch" })

export interface Result extends Schema.Schema.Type<typeof Result> {}
export const Result = Schema.Struct({
  appId: App.ID,
  slug: Primitive.Slug,
  revision: Schema.Int,
  changed: Schema.Struct({ execution: Schema.Boolean, metadata: Schema.Boolean, listing: Schema.Boolean }),
}).annotate({ identifier: "AppRegistry.Result" })

export interface BatchResult extends Schema.Schema.Type<typeof BatchResult> {}
export const BatchResult = Schema.Struct({ apps: Schema.Array(Result) }).annotate({
  identifier: "AppRegistry.BatchResult",
})

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: App.ID,
  slug: Primitive.Slug,
  name: Primitive.Name,
  description: Schema.NonEmptyString,
  icon: Schema.NullOr(Schema.String),
  listing: AppListing.Info,
  requiredCredentials: App.Info.fields.requiredCredentials,
  environment: App.Info.fields.environment,
  mcps: App.Info.fields.mcps,
  skills: Schema.Record(Primitive.Slug, Skill.Summary),
  dependsOn: App.Info.fields.dependsOn,
  revision: Schema.Int,
}).annotate({ identifier: "AppRegistry.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  query: Schema.optional(
    Schema.String.annotate({ description: "Match the slug, name or description, ignoring case." }),
  ),
  category: Schema.optional(Primitive.Slug.annotate({ description: "Match a category in any group." })),
  ...Pagination.fields(50),
}).annotate({ identifier: "AppRegistry.ListInput" })

export const definition = Primitive.define({
  name: "app-registry",
  plural: "app-registry",
  id: App.ID,
  info: Info,
  list: { input: ListInput, page: Pagination.Page(Info).annotate({ identifier: "AppRegistry.Page" }) },
  get: true,
})
