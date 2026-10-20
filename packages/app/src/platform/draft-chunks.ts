export * as DraftChunks from "./draft-chunks.js"

const threshold = 16 * 1024

export const size = 64 * 1024

export const large = (text: string) => text.length >= threshold

const highSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff

export function split(text: string): ReadonlyArray<string> {
  const from = (start: number): ReadonlyArray<string> => {
    if (start >= text.length) return []
    const end = Math.min(start + size, text.length)
    const stop = end < text.length && highSurrogate(text.charCodeAt(end - 1)) ? end + 1 : end
    return [text.slice(start, stop), ...from(stop)]
  }
  return from(0)
}

export interface Chunk {
  readonly index: number
  readonly text: string
}

export const changed = (previous: ReadonlyArray<string> | undefined, next: ReadonlyArray<string>) =>
  next.flatMap((text, index): ReadonlyArray<Chunk> => (previous?.[index] === text ? [] : [{ index, text }]))

export const join = (count: number, chunk: (index: number) => string | undefined) =>
  Array.from({ length: count }, (_, index) => chunk(index) ?? "").join("")
