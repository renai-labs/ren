export * as DriveSearch from "./drive-search.js"

import { Schema } from "effect"
import { Artifacts } from "./artifacts.js"
import { FolderSearch } from "./folder-search.js"
import { Loader } from "./loader.js"
import type { Runtime } from "./runtime.js"

export type Home = { readonly kind: "org" } | { readonly kind: "space"; readonly spaceId: string }

const SearchSchema = Schema.Struct({ space: Schema.optional(Schema.String), ...FolderSearch.fields })

export type Search = typeof SearchSchema.Type

export const Search = Schema.toStandardSchemaV1(SearchSchema)

export const listInput = (search: Pick<Search, "space" | "folder">) => ({
  source: "drive" as const,
  ...(search.space && { spaceId: search.space }),
  ...(search.folder && { folder: search.folder }),
})

export const preload = (context: Runtime.Context, deps: Pick<Search, "space" | "folder">) =>
  Loader.start(context.queryClient.query(context.api.files.list.queryOptions(listInput(deps))))

const ArtifactsSchema = Schema.Struct({ space: Schema.optional(Schema.String) })

export const ArtifactsSearch = Schema.toStandardSchemaV1(ArtifactsSchema)

export const preloadArtifacts = (context: Runtime.Context, deps: typeof ArtifactsSchema.Type) =>
  Loader.start(context.queryClient.query(Artifacts.allOptions(context.client, deps.space)))
