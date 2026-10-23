export * as AppRegistry from "./app-registry.js"

import { Schema } from "effect"
import { App } from "./app.js"
import { AppListing } from "./app-listing.js"
import { AppRelease } from "./app-release.js"
import { Auth } from "./auth.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"

export interface Publication extends Schema.Schema.Type<typeof Publication> {}
export const Publication = Schema.Struct({
  ...App.Declaration.fields,
  slug: Primitive.Slug,
  organizationId: Schema.optionalKey(
    Auth.OrganizationID.annotate({
      description:
        "The organization that owns the app. Required to list an organization’s app, and absent for a registry app. Publication never changes the owner.",
    }),
  ),
  version: Schema.optionalKey(AppRelease.Version),
  bump: Schema.optionalKey(Schema.Literals(["patch", "minor", "major"])),
  expectedCurrentReleaseId: Schema.optionalKey(
    AppRelease.ID.annotate({ description: "Publish only while this release is still the app’s latest." }),
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
  releaseId: AppRelease.ID,
  version: AppRelease.Version,
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
  release: AppRelease.Info,
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
