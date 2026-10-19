export * as PatchFiles from "./patch-files.js"

import type { SessionMessage } from "@ren/schema/session-message"
import { createTwoFilesPatch, diffLines } from "diff"
import { Predicate, Schema } from "effect"
import { FileDiff } from "./file-diff.js"
import { ToolState } from "./tool-state.js"

export type Kind = "add" | "update" | "delete"

export interface Changed {
  readonly file: string
  readonly patch: string
  readonly additions: number
  readonly deletions: number
  readonly status: FileDiff.Status
}

export interface File {
  readonly path: string
  readonly type: Kind
  readonly additions: number
  readonly deletions: number
  readonly view: FileDiff.View
  readonly contents: { readonly before: string; readonly after: string } | undefined
}

export interface Group {
  readonly path: string
  readonly type: Kind
  readonly additions: number
  readonly deletions: number
  readonly views: ReadonlyArray<FileDiff.View>
}

const isChanged = Schema.is(
  Schema.Struct({
    file: Schema.String,
    patch: Schema.String,
    additions: Schema.Number,
    deletions: Schema.Number,
    status: Schema.Literals(["added", "deleted", "modified"]),
  }),
)

export const changedFileDiff = (value: unknown): value is Changed =>
  isChanged(value) && (value.additions > 0 || value.deletions > 0)

const kinds: Readonly<Record<FileDiff.Status, Kind>> = { added: "add", deleted: "delete", modified: "update" }

export const patchFile = (value: unknown): File | undefined => {
  if (!changedFileDiff(value)) return
  const cached: { view?: FileDiff.View } = {}
  return {
    path: value.file,
    type: kinds[value.status],
    additions: value.additions,
    deletions: value.deletions,
    get view() {
      cached.view ??= FileDiff.normalize(value)
      return cached.view
    },
    contents: FileDiff.completePatchContents(value.patch),
  }
}

export const patchFiles = (value: unknown): ReadonlyArray<File> =>
  Array.isArray(value) ? value.flatMap((item) => patchFile(item) ?? []) : []

const statuses: Readonly<Record<Kind, FileDiff.Status>> = { add: "added", delete: "deleted", update: "modified" }

const groupType = (first: File, last: File): Kind => {
  if (last.type === "delete") return "delete"
  return first.type === "add" ? "add" : "update"
}

const group = (path: string, files: ReadonlyArray<File>): Group | undefined => {
  const first = files.at(0)
  const last = files.at(-1)
  if (!first || !last) return
  const type = groupType(first, last)
  const chained = files.every(
    (file, index) =>
      Boolean(file.contents) && (index === 0 || files.at(index - 1)?.contents?.after === file.contents?.before),
  )
  if (!chained)
    return {
      path,
      type,
      additions: files.reduce((total, file) => total + file.additions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
      views: files.map((file) => file.view),
    }
  const view =
    files.length === 1
      ? first.view
      : FileDiff.normalize({
          file: path,
          before: first.contents?.before ?? "",
          after: last.contents?.after ?? "",
          status: statuses[type],
          additions: 0,
          deletions: 0,
        })
  const counts = view.diff.hunks.reduce(
    (result, hunk) => ({ additions: result.additions + hunk.additions, deletions: result.deletions + hunk.deletions }),
    { additions: 0, deletions: 0 },
  )
  return { path, type, ...counts, views: [{ ...view, ...counts }] }
}

export const patchFileGroups = (value: unknown): ReadonlyArray<Group> => {
  const byPath = patchFiles(value).reduce((result, file) => {
    const files = result.get(file.path)
    if (files) files.push(file)
    else result.set(file.path, [file])
    return result
  }, new Map<string, Array<File>>())
  return [...byPath.values()].flatMap((files) => {
    const path = files.at(0)?.path
    return path ? (group(path, files) ?? []) : []
  })
}

const editFile = (path: string, before: string, after: string): ReadonlyArray<Changed> => {
  const changes = diffLines(before, after)
  const additions = changes.filter((change) => change.added).reduce((total, change) => total + change.count, 0)
  const deletions = changes.filter((change) => change.removed).reduce((total, change) => total + change.count, 0)
  if (additions === 0 && deletions === 0) return []
  return [
    { file: path, patch: createTwoFilesPatch(path, path, before, after), additions, deletions, status: "modified" },
  ]
}

const pathOf = (input: Readonly<Record<string, unknown>>) => [input.path, input.filePath].find(Predicate.isString)

export const toolFiles = (tool: SessionMessage.Tool): ReadonlyArray<unknown> => {
  const files = ToolState.metadata(tool).files
  if (Array.isArray(files) && files.length > 0) return files
  const input = ToolState.input(tool)
  const path = pathOf(input)
  if (!path) return []
  if (tool.name === "edit" && typeof input.oldString === "string" && typeof input.newString === "string")
    return editFile(path, input.oldString, input.newString)
  if (tool.name !== "write" || typeof input.content !== "string" || !input.content) return []
  return [
    {
      file: path,
      patch: createTwoFilesPatch(path, path, "", input.content),
      additions: input.content.split("\n").length - Number(input.content.endsWith("\n")),
      deletions: 0,
      status: "modified",
    },
  ]
}

export const isFileChange = (tool: SessionMessage.Tool) =>
  tool.state.status !== "error" &&
  (tool.name === "edit" || tool.name === "write" || tool.name === "patch" || tool.name === "apply_patch")

export const groups = (tools: ReadonlyArray<SessionMessage.Tool>) => patchFileGroups(tools.flatMap(toolFiles))
