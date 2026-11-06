export * as RenFileSystem from "./filesystem.js"

import type { EnvironmentFiles } from "@opencode/core/environment/files"
import { FileSystem } from "@opencode/core/filesystem"
import { FileSystemSearch } from "@opencode/core/filesystem/search"
import { Location } from "@opencode/core/location"
import { Entry, Write } from "@opencode/schema/filesystem"
import { AbsolutePath, RelativePath } from "@opencode/schema/schema"
import type { Workspace } from "@opencode/schema/workspace"
import { tags } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Layer, Option, Stream } from "effect"
import path from "node:path"

const unavailable = (what: string) =>
  Effect.die(new Error(`${what} needs the chat's hand, and this chat has none on a brain with remote hands`))

// oxlint-disable-next-line ren/no-comments -- OpenCode's FileSystem reads the brain's disk (`filesystem.ts:114-119`, OpenCode #44568); with a remote hand, the workspace panel reads the hand's files instead (EN13).
const layer = (filesOf: (workspaceId: Workspace.ID) => EnvironmentFiles.FilesImpl) =>
  Layer.effect(
    FileSystem.Service,
    Effect.gen(function* () {
      const location = yield* Location.Service
      const search = yield* FileSystemSearch.Service
      const files = Option.map(Option.fromNullishOr(location.workspaceID), filesOf)
      if (Option.isNone(files))
        return FileSystem.Service.of({
          find: search.find,
          read: () => unavailable("FileSystem.read"),
          list: () => unavailable("FileSystem.list"),
          write: () => unavailable("FileSystem.write"),
        })
      const hand = files.value
      const inside = (relative: string) => {
        const absolute = path.resolve(location.directory, relative)
        return relative.includes("\u0000") || !FSUtil.contains(location.directory, absolute)
          ? Option.none()
          : Option.some(absolute)
      }
      return FileSystem.Service.of({
        find: search.find,
        read: Effect.fn("RenFileSystem.read")(function* (input) {
          const missing = new FileSystem.NotFoundError({ path: input.path })
          const absolute = inside(input.path)
          if (Option.isNone(absolute)) return yield* missing
          const found = yield* hand.read(absolute.value, { offset: 0, length: 0 }).pipe(
            Effect.catchTags({
              "Environment.NotFound": () => missing,
              "Environment.WrongKind": () => missing,
              "Environment.Failed": Effect.die,
            }),
          )
          if (found.info.type !== "file") return yield* missing
          return {
            mime: FSUtil.mimeType(absolute.value),
            size: found.info.size,
            mtime: Option.some(new Date(found.info.mtimeMs)),
            stream: (options) =>
              Stream.fromEffect(
                hand
                  .read(absolute.value, {
                    offset: options?.offset ?? 0,
                    length: options?.bytesToRead ?? found.info.size,
                  })
                  .pipe(
                    Effect.map((read) => read.bytes),
                    Effect.orDie,
                  ),
              ),
          }
        }),
        list: Effect.fn("RenFileSystem.list")(function* (input = {}) {
          const directory = path.resolve(location.directory, input.path ?? ".")
          const missing = new FileSystem.NotFoundError({ path: RelativePath.make(input.path ?? ".") })
          const entries = yield* hand.list(directory).pipe(
            Effect.catchTags({
              "Environment.NotFound": () => missing,
              "Environment.WrongKind": () => missing,
              "Environment.Failed": Effect.die,
            }),
          )
          return entries
            .flatMap((item) => {
              if (item.type !== "file" && item.type !== "directory") return []
              const relative = path.relative(location.directory, path.join(directory, item.name)) || "."
              return [
                Entry.make({
                  path: RelativePath.make(relative + (item.type === "directory" ? path.sep : "")),
                  type: item.type,
                }),
              ]
            })
            .toSorted((a, b) => {
              if (a.type === b.type) return a.path.localeCompare(b.path)
              return a.type === "directory" ? -1 : 1
            })
        }),
        write: Effect.fn("RenFileSystem.write")(function* (input) {
          const target = path.resolve(location.directory, input.path)
          yield* hand.write(target, input.data).pipe(Effect.orDie)
          return Write.make({ path: AbsolutePath.make(target) })
        }),
      })
    }),
  )

export const node = (filesOf: (workspaceId: Workspace.ID) => EnvironmentFiles.FilesImpl) =>
  LayerNode.make({
    service: FileSystem.Service,
    tag: tags.values.location,
    layer: layer(filesOf),
    deps: [Location.node, FileSystemSearch.node],
  })
