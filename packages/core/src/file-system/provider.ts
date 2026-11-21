export * as FileSystemProvider from "./provider.js"

import type { FileSystem } from "@ren/schema/file-system"
import type { Space } from "@ren/schema/space"
import { type Effect, Schema } from "effect"
import type { Actor } from "../actor.js"
import type { Primitive } from "../primitive.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("FileSystem.Unavailable", {
  cause: Schema.Defect(),
}) {}

export type Error = Primitive.NotFound | Primitive.Forbidden | Primitive.Invalid | Unavailable

export interface ListInput {
  readonly spaceId?: Space.ID | undefined
  readonly folder?: string | undefined
  readonly cursor?: string | undefined
}

export interface PathInput {
  readonly spaceId?: Space.ID | undefined
  readonly path: string
}

// oxlint-disable-next-line ren/no-comments -- One backend of files. Each validates its own paths and puts in a page's actions only what its policy lets the actor do.
export interface Interface {
  readonly list: (actor: Actor.Info, input: ListInput) => Effect.Effect<FileSystem.Page, Error>
  readonly read: (actor: Actor.Info, input: PathInput) => Effect.Effect<FileSystem.Content, Error>
  readonly remove: (actor: Actor.Info, input: PathInput) => Effect.Effect<void, Error>
}

export const folderOf = (folder: string | undefined) => folder?.replace(/\/+$/u, "") ?? ""

const rank = (entry: FileSystem.Entry) => (entry.type === "directory" ? 0 : 1)

export const sorted = (entries: ReadonlyArray<FileSystem.Entry>) =>
  entries.toSorted((a, b) => rank(a) - rank(b) || Number(a.path > b.path) - Number(a.path < b.path))
