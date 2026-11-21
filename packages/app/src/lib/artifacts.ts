export * as Artifacts from "./artifacts.js"

export type Mention = { readonly id: string; readonly title: string }

const whitespace = /\s/
const word = /[\p{L}\p{N}_]/u

export const mentionRanges = (text: string, artifact?: Mention) => {
  if (!artifact?.title) return []
  const mention = `@${artifact.title}`
  return [...text.matchAll(/@/g)]
    .map((match) => ({ start: match.index, end: match.index + mention.length }))
    .filter(
      (range) =>
        text.startsWith(mention, range.start) &&
        (range.start === 0 || whitespace.test(text.charAt(range.start - 1))) &&
        (range.end === text.length || !word.test(text.charAt(range.end))),
    )
}

export const resolveMention = (text: string, artifact?: Mention) => {
  if (!artifact) return text
  return mentionRanges(text, artifact).reduceRight(
    (resolved, range) => `${resolved.slice(0, range.end)} (artifact ID: ${artifact.id})${resolved.slice(range.end)}`,
    text,
  )
}
