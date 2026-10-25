export * as OAuthSearch from "./oauth-search.js"

import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router"
import { Schema } from "effect"

const Strings = Schema.Array(Schema.String)

export function parse(search: string): Record<string, unknown> {
  const params = new URLSearchParams(search)
  if (!params.has("sig")) return defaultParseSearch(search)
  return Object.fromEntries(
    [...new Set(params.keys())].map((key) => {
      const values = params.getAll(key)
      return [key, values.length === 1 ? values[0] : values]
    }),
  )
}

export function stringify(search: Record<string, unknown>): string {
  const fallback = defaultStringifySearch(search)
  if (typeof search.sig !== "string") return fallback
  const params = new URLSearchParams(fallback)
  return `?${new URLSearchParams(
    Object.entries(search).flatMap(([key, value]) => {
      if (typeof value === "string") return [[key, value]]
      return (Schema.is(Strings)(value) ? value : params.getAll(key)).map((item) => [key, item])
    }),
  )}`
}
