import { Schema } from "effect"

export type WordLink =
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "internal"; readonly bookmark: string }

export const WordSpan = Schema.Struct({
  text: Schema.String,
  left: Schema.Number,
  top: Schema.Number,
  size: Schema.Number,
  transform: Schema.String,
  dir: Schema.Literals(["ltr", "rtl"]),
  link: Schema.UndefinedOr(
    Schema.Union([
      Schema.Struct({ kind: Schema.Literal("external"), url: Schema.String }),
      Schema.Struct({ kind: Schema.Literal("internal"), bookmark: Schema.String }),
    ]),
  ),
  title: Schema.UndefinedOr(Schema.String),
  after: Schema.UndefinedOr(Schema.Literals(["br", "tab"])),
})
export type WordSpan = typeof WordSpan.Type

export const BookmarkTarget = Schema.UndefinedOr(
  Schema.NullOr(Schema.Struct({ index: Schema.Number, y: Schema.Number })),
)

export type WordPageSize = { readonly width: number; readonly height: number; readonly background: string | undefined }

export const lineHeight = 1.2

export const layerFont = "sans-serif"
