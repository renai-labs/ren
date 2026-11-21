export * as AppRegistry from "./app-registry.js"

import { Schema } from "effect"
import { App } from "./app.js"
import { AppListing } from "./app-listing.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"

export const descriptionMaxLength = 50

export interface Publication extends Schema.Schema.Type<typeof Publication> {}
export const Publication = Schema.Struct({
  ...App.Declaration.fields,
  description: Schema.NonEmptyString.check(Schema.isMaxLength(descriptionMaxLength)).annotate({
    description: `One line in the catalog: at most ${descriptionMaxLength} characters. The listing body holds the rest.`,
  }),
  slug: Primitive.Slug,
  expectedRevision: Schema.optionalKey(
    Schema.Int.annotate({ description: "Publish only while the app’s definition is still at this revision." }),
  ),
  listing: Schema.optionalKey(
    AppListing.Input.annotate({ description: "Omit to leave the app’s listing, or its absence, unchanged." }),
  ),
})
  .check(
    Schema.makeFilter((app) =>
      Object.keys(app.listing?.tools ?? {})
        .filter((slug) => !(slug in app.mcps))
        .map((slug) => ({
          path: ["listing", "tools", slug],
          issue: `The listing names tools of MCP "${slug}", which the app does not declare.`,
        })),
    ),
  )
  .annotate({ identifier: "AppRegistry.Publication" })

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
  listing: AppListing.Summary,
  managed: Schema.Boolean.annotate({
    description: "True when the app has an MCP that Ren runs and Ren credits pay for, so it works with no sign-in.",
  }),
  revision: Schema.Int,
}).annotate({
  identifier: "AppRegistry.Info",
  description: "A registry app as the catalog shows it. app.get returns its MCPs, skills and keys.",
})

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  query: Schema.optional(
    Schema.String.annotate({ description: "Match the slug, name or description, ignoring case." }),
  ),
  category: Schema.optional(Primitive.Slug.annotate({ description: "Match a category in any group." })),
  slugs: Schema.optional(
    Schema.Array(Primitive.Slug).annotate({ description: "Only the apps with these slugs, in slug order." }),
  ),
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
