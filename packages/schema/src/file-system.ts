export * as FileSystem from "./file-system.js"

import { Result, Schema } from "effect"
import { Base64 } from "effect/encoding"
import { Space } from "./space.js"

// oxlint-disable-next-line ren/no-comments -- The most of a file that a read returns; a larger file returns its start, with truncated set.
export const readLimit = 1024 * 1024

export const EntryType = Schema.Literals(["file", "directory"]).annotate({ identifier: "FileSystem.EntryType" })
export type EntryType = typeof EntryType.Type

export interface Entry extends Schema.Schema.Type<typeof Entry> {}
export const Entry = Schema.Struct({
  path: Schema.String.annotate({ description: "The path inside its source. A folder’s path ends with `/`." }),
  type: EntryType,
  size: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({ description: "In bytes." })),
  modifiedAt: Schema.optionalKey(Schema.DateTimeUtc),
  mime: Schema.optionalKey(Schema.String),
}).annotate({
  identifier: "FileSystem.Entry",
  description: "A file or a folder. A source omits what it does not know.",
})

export const Action = Schema.Literals(["upload", "write", "remove"]).annotate({
  identifier: "FileSystem.Action",
  description:
    "`upload`: add files to the folder through the source’s upload. `write`: create and edit files in the folder. `remove`: delete files of the folder.",
})
export type Action = typeof Action.Type

export interface Page extends Schema.Schema.Type<typeof Page> {}
export const Page = Schema.Struct({
  entries: Schema.Array(Entry).annotate({ description: "Folders first, then files, each sorted by path." }),
  cursor: Schema.NullOr(Schema.String).annotate({ description: "Null on the last page." }),
  actions: Schema.Array(Action).annotate({ description: "What the caller may do in the folder." }),
}).annotate({ identifier: "FileSystem.Page", description: "One page of the entries directly in a folder." })

export interface Content extends Schema.Schema.Type<typeof Content> {}
export const Content = Schema.Struct({
  path: Schema.String,
  mime: Schema.String,
  size: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({ description: "The whole file’s size in bytes." }),
  encoding: Schema.Literals(["utf8", "base64"]),
  content: Schema.String,
  truncated: Schema.Boolean.annotate({ description: "True when content is only the file’s start." }),
}).annotate({ identifier: "FileSystem.Content", description: "A file: text as `utf8`, anything else as `base64`." })

export const Source = Schema.Literals(["drive", "memory"]).annotate({
  identifier: "FileSystem.Source",
  description: "`drive`: the files of a drive. `memory`: the files of a memory.",
})
export type Source = typeof Source.Type

const scope = {
  source: Source,
  spaceId: Schema.optional(
    Space.ID.annotate({ description: "The space whose files to use. Omit it for the organization’s." }),
  ),
}

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  ...scope,
  folder: Schema.optional(
    Schema.String.annotate({ description: "The folder to list, such as `reports/`. Omit it for the root." }),
  ),
  cursor: Schema.optional(
    Schema.String.annotate({ description: "The `cursor` of the previous page, to list the next one." }),
  ),
}).annotate({ identifier: "FileSystem.ListInput" })

export interface PathInput extends Schema.Schema.Type<typeof PathInput> {}
export const PathInput = Schema.Struct({
  ...scope,
  path: Schema.String.annotate({ description: "A file’s path inside its source, such as `reports/q3.pdf`." }),
}).annotate({ identifier: "FileSystem.PathInput" })

export const contentOf = (file: {
  readonly path: string
  readonly mime: string
  readonly size: number
  readonly bytes: Uint8Array
}): Content => {
  const truncated = file.size > file.bytes.length
  const text = file.bytes.includes(0)
    ? Result.fail(undefined)
    : Result.try(() =>
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(file.bytes, { stream: truncated }),
      )
  return {
    path: file.path,
    mime: file.mime,
    size: file.size,
    truncated,
    ...(Result.isSuccess(text)
      ? { encoding: "utf8", content: text.success }
      : { encoding: "base64", content: Base64.encode(file.bytes) }),
  }
}
