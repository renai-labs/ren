export * as TypeText from "./type-text.js"

const referencePattern = (name: string, flags: string) =>
  new RegExp(`(?<![A-Za-z0-9_$.'"])${name.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_$.'"])`, flags)

export function mentionsReference(type: string, name: string) {
  return referencePattern(name, "").test(type)
}

export function replaceReference(type: string, name: string, replacement: string) {
  return type.replaceAll(referencePattern(name, "g"), replacement)
}

export function preserveStringSuggestions(type: string) {
  return type.replaceAll(/((?:"(?:\\.|[^"\\])*"\s*\|\s*)+)string\b/g, "$1(string & {})")
}
