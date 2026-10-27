export * as Memory from "./memory.js"

import { Schema } from "effect"
import { Space } from "./space.js"

export const root = "memory.md"

// oxlint-disable-next-line ren/no-comments -- memory M9: the part of a root file that goes in every turn's context; the agent reads the rest with the read tool.
export const injectedLength = 16_000

export const Path = Schema.String.annotate({
  identifier: "Memory.Path",
  description: `A file path relative to the memory root, such as \`${root}\` or \`people/ana.md\`.`,
})

export const Files = Schema.Record(Schema.String, Schema.String).annotate({
  identifier: "Memory.Files",
  description: "The files of one memory, by path relative to its root: the same shape as a skill’s files.",
})
export type Files = typeof Files.Type

const scope = {
  spaceId: Schema.optional(
    Space.ID.annotate({ description: "The space whose memory to use. Omit it for the organization’s memory." }),
  ),
}

export interface File extends Schema.Schema.Type<typeof File> {}
export const File = Schema.Struct({ path: Path, content: Schema.String }).annotate({ identifier: "Memory.File" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  ...scope,
  prefix: Schema.optional(
    Schema.String.annotate({ description: "Only the files whose path starts with it, such as `people/`." }),
  ),
}).annotate({ identifier: "Memory.ListInput" })

export interface PathInput extends Schema.Schema.Type<typeof PathInput> {}
export const PathInput = Schema.Struct({ ...scope, path: Path }).annotate({ identifier: "Memory.PathInput" })

export interface WriteInput extends Schema.Schema.Type<typeof WriteInput> {}
export const WriteInput = Schema.Struct({
  ...scope,
  path: Path,
  content: Schema.String.annotate({ description: "The whole new content of the file." }),
}).annotate({ identifier: "Memory.WriteInput" })

export interface EditInput extends Schema.Schema.Type<typeof EditInput> {}
export const EditInput = Schema.Struct({
  ...scope,
  path: Path,
  oldString: Schema.NonEmptyString.annotate({ description: "The exact text to replace." }),
  newString: Schema.String,
  replaceAll: Schema.optional(
    Schema.Boolean.annotate({ description: "Replace every occurrence. Without it, oldString must occur once." }),
  ),
}).annotate({ identifier: "Memory.EditInput" })

export interface Root extends Schema.Schema.Type<typeof Root> {}
export const Root = Schema.Struct({
  content: Schema.String.annotate({ description: `The start of \`${root}\`, at most ${injectedLength} characters.` }),
  truncated: Schema.Boolean,
}).annotate({ identifier: "Memory.Root" })
