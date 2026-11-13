import { Schema } from "effect"

export type PreviewProps = {
  bytes: ArrayBuffer
  zoom: number | "fit"
  query: string
  active: number
  onCount: (count: number) => void
  onError: () => void
}

export type Kind = "pdf" | "docx" | "pptx" | "xlsx"

const byMime: Readonly<Record<string, Kind>> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
}

const office = ["docx", "pptx", "xlsx"] as const

export const kindOf = (file: { readonly name: string; readonly mime: string }) =>
  byMime[file.mime] ?? office.find((extension) => file.name.toLowerCase().endsWith(`.${extension}`))

export const maxFitWidth = 880
export const maxPreviewBytes = 50 * 1024 * 1024
export const maxSheetRows = 10_000

export const SheetTabs = Schema.Array(Schema.Struct({ index: Schema.Number, name: Schema.String }))
export const Sheet = Schema.Struct({
  rows: Schema.Array(Schema.Array(Schema.String)),
  truncated: Schema.Boolean,
})
