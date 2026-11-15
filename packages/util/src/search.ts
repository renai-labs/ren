export * as Search from "./search.js"

export const matches = (query: string, ...texts: ReadonlyArray<string | null | undefined>) => {
  const needle = query.trim().toLowerCase()
  return texts.some((text) => (text ?? "").toLowerCase().includes(needle))
}

export const empty = (query: string, fallback: string) =>
  query.trim() ? `Nothing matches “${query.trim()}”` : fallback
