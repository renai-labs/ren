export * as FileMentions from "./file-mentions.js"

import { Drive } from "@ren/schema/drive"
import type { FileSystem } from "@ren/schema/file-system"
import type { SessionMessage } from "@ren/schema/session/message"
import { Option } from "effect"
import { InlineCodeKind } from "./inline-code-kind.js"
import { ShownFile } from "./shown-file.js"
import { ToolState } from "./tool-state.js"

export interface Known {
  readonly file: SessionMessage.DriveFile
  readonly source?: string | undefined
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

export const listed = (entries: ReadonlyArray<FileSystem.Entry>): ReadonlyArray<Known> =>
  entries.flatMap((entry) => {
    if (entry.type !== "file") return []
    const name = entry.path.slice(entry.path.lastIndexOf("/") + 1)
    return [{ file: { path: entry.path, name, mime: entry.mime ?? Drive.typeOf(name), size: entry.size ?? 0 } }]
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
