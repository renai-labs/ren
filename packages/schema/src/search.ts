export * as Search from "./search.js"

import { Schema } from "effect"

export const Text = Schema.Trim.check(Schema.isMaxLength(200)).annotate({ identifier: "Search.Text" })

export const field = (fields: string) =>
  Schema.optional(Text).annotate({
    description: `Words to find in any case: each must be part of ${fields}.`,
  })

export const words = (text: string | undefined) => text?.toLowerCase().split(/\s+/u).filter(Boolean) ?? []

export const matches = (text: string, ...fields: ReadonlyArray<string | null | undefined>) => {
  const lower = fields.map((field) => field?.toLowerCase() ?? "")
  return words(text).every((word) => lower.some((field) => field.includes(word)))
}

export const empty = (text: string, fallback: string) => (text.trim() ? `Nothing matches “${text.trim()}”` : fallback)
