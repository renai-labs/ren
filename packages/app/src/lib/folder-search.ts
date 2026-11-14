export * as FolderSearch from "./folder-search.js"

import { Schema } from "effect"

export const fields = {
  folder: Schema.optional(Schema.String),
  file: Schema.optional(Schema.String),
}

const SearchSchema = Schema.Struct(fields)

export const Search = Schema.toStandardSchemaV1(SearchSchema)
