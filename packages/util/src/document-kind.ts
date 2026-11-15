export * as DocumentKind from "./document-kind.js"

export type Kind = "pdf" | "docx" | "pptx" | "xlsx"

const byMime: Readonly<Record<string, Kind>> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
}

const office = ["docx", "pptx", "xlsx"] as const

export const of = (file: { readonly name: string; readonly mime: string }): Kind | undefined =>
  byMime[file.mime] ?? office.find((extension) => file.name.toLowerCase().endsWith(`.${extension}`))
