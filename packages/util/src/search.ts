export * as Search from "./search.js"

export function matches(texts: ReadonlyArray<string>, query: string) {
  const needle = query.trim().toLowerCase()
  return texts.some((text) => text.toLowerCase().includes(needle))
}
