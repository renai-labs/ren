export * as FileMentions from "./file-mentions.js"

import type { SessionMessage } from "@ren/schema/session/message"
import { Option } from "effect"
import { InlineCodeKind } from "./inline-code-kind.js"
import { ShownFile } from "./shown-file.js"
import { ToolState } from "./tool-state.js"

export interface Known {
  readonly file: SessionMessage.DriveFile
  readonly source?: string | undefined
}

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

const normal = (path: string) =>
  InlineCodeKind.relativePath(InlineCodeKind.parsePathLineSuffix(path).path).replace(/^(?:\.\/)+/u, "")

export const known = (messages: ReadonlyArray<SessionMessage.Info>): ReadonlyArray<Known> =>
  messages.flatMap((message): ReadonlyArray<Known> => {
    if (message.type === "user") return (message.uploads ?? []).map((file) => ({ file }))
    if (message.type !== "assistant") return []
    return message.content.flatMap((part) => {
      if (part.type !== "tool") return []
      const source = ToolState.input(part).path
      return Option.toArray(ShownFile.of(part)).map((file) => ({
        file,
        source: typeof source === "string" ? normal(source) : undefined,
      }))
    })
  })

export const find = (files: ReadonlyArray<Known>, text: string) => {
  const path = normal(text)
  return files.findLast(
    (entry) =>
      path === entry.file.path ||
      path === entry.file.name ||
      path === `outputs/${entry.file.name}` ||
      path === entry.source ||
      entry.source?.endsWith(`/${path}`) === true,
  )?.file
}
