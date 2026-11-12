import { Schema } from "effect"

export type PreviewProps = {
  bytes: ArrayBuffer
  zoom: number | "fit"
  query: string
  active: number
  onCount: (count: number) => void
  onError: () => void
}

export const maxPreviewBytes = 50 * 1024 * 1024
export const maxSheetRows = 10_000

export const SheetTabs = Schema.Array(Schema.Struct({ index: Schema.Number, name: Schema.String }))
export const Sheet = Schema.Struct({
  rows: Schema.Array(Schema.Array(Schema.String)),
  truncated: Schema.Boolean,
})
