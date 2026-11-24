export * as FileMention from "./file-mention.js"

export interface Part {
  readonly text: string
  readonly mention: boolean
}

const mention =
  /(?<![\p{L}\p{N}_@+./\\-])(?:\.{0,2}\/)?(?:[\p{L}\p{N}_@+-][\p{L}\p{N}_@+.-]*\/)*[\p{L}\p{N}_@+-][\p{L}\p{N}_@+.-]*\.[A-Za-z][A-Za-z0-9]{1,7}(?:#L\d+(?:-L?\d+)?|:\d+(?:-\d+)?)?(?![\p{L}\p{N}_@+/-])/gu

export const split = (text: string): ReadonlyArray<Part> => {
  const found = Array.from(text.matchAll(mention))
  const ends = [0, ...found.map((match) => match.index + match[0].length)]
  return [
    ...found.flatMap((match, index) => [
      { text: text.slice(ends[index], match.index), mention: false },
      { text: match[0], mention: true },
    ]),
    { text: text.slice(ends.at(-1)), mention: false },
  ].filter((part) => part.text !== "")
}
