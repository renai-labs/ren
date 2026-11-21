import { DocumentKind } from "@ren/util/document-kind"
import { Schema } from "effect"

export type PreviewProps = {
  bytes: ArrayBuffer
  zoom: number | "fit"
  query: string
  active: number
  onCount: (count: number) => void
  onError: () => void
}

export type Kind = DocumentKind.Kind | "csv"

const tables = new Set(["text/csv", "text/tab-separated-values"])

export const kindOf = (file: { readonly name: string; readonly mime: string }): Kind | undefined =>
  DocumentKind.of(file) ?? (tables.has(file.mime) || /\.(csv|tsv)$/i.test(file.name) ? "csv" : undefined)

export const maxFitWidth = 880
export const maxPreviewBytes = 50 * 1024 * 1024
export const maxSheetRows = 10_000

export const SheetTabs = Schema.Array(Schema.Struct({ index: Schema.Number, name: Schema.String }))
export const Sheet = Schema.Struct({
  rows: Schema.Array(Schema.Array(Schema.String)),
  truncated: Schema.Boolean,
})
