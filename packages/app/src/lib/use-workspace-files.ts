import { useEffect, useState } from "react"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { FileSystem } from "@ren/schema/file-system"
import { toast } from "@ren/ui/sonner"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useDebouncedValue } from "./use-debounced-value.js"
import { useRefreshOn } from "./use-refresh-on.js"

const searchDelay = 200

const gitFolder = /(?:^|\/)\.git(?:\/|$)/u

const dependencyFolder = /(?:^|\/)node_modules\/$/u

const aheadLimit = 50

export const ancestorsOf = (path: string) =>
  path
    .split("/")
    .slice(0, -1)
    .map((_, index, parents) => `${parents.slice(0, index + 1).join("/")}/`)

const foldersOf = (path: string) => ["", ...ancestorsOf(path)]

const lineageOf = (path: string) => [...ancestorsOf(path), path]

const withSlash = (path: string) => (path.endsWith("/") ? path : `${path}/`)

type Listed = { readonly entries: ReadonlyArray<Pick<FileSystem.Entry, "path" | "type">> }

const listedOf = (result: AsyncResult.AsyncResult<Listed, unknown>) =>
  Option.match(AsyncResult.value(result), { onNone: () => [], onSome: (page) => page.entries })

const pathsOf = (results: ReadonlyArray<AsyncResult.AsyncResult<Listed, unknown>>) =>
  results.flatMap((result) =>
    listedOf(result).map((entry) => (entry.type === "directory" ? withSlash(entry.path) : entry.path)),
  )

function useFolderFailures(
  results: ReadonlyArray<readonly [string, AsyncResult.AsyncResult<unknown, unknown>]>,
  refreshFolder: (path: string) => void,
) {
  const failures = results.flatMap(([path, result]) => (path && AsyncResult.isFailure(result) ? [path] : [])).join("\n")
  useEffect(() => {
    for (const path of failures.split("\n").filter(Boolean))
      toast.error("Could not list the files", {
        id: path,
        description: path,
        action: { label: "Retry", onClick: () => refreshFolder(path) },
      })
  }, [failures, refreshFolder])
}

export interface Expansion {
  readonly expanded: ReadonlyArray<string>
  readonly setExpanded: (change: (previous: ReadonlyArray<string>) => ReadonlyArray<string>) => void
}

export const revealIn = (expanded: ReadonlyArray<string>, path: string) => {
  const missing = ancestorsOf(path).filter((parent) => !expanded.includes(parent))
  return missing.length > 0 ? [...expanded, ...missing] : expanded
}

// oxlint-disable-next-line ren/no-comments -- Lists one project, a folder in the chat's folder. Tree paths and git status are relative to `base`. Prefix a path with `base` before you open or mention its file.
export function useWorkspaceFiles(root: Session.ID, edited: ReadonlyArray<string>, base: string, expansion: Expansion) {
  const expanded = expansion.expanded
  const setExpanded = expansion.setExpanded
  const [query, setQuery] = useState("")
  const opened = base ? [base, ...expanded] : expanded
  const folders = ChatReact.useFolders(root, opened)
  const ahead = ChatReact.useFolders(
    root,
    [base, ...expanded.filter((path) => path.startsWith(base))].flatMap((path) => {
      const result = folders.results.get(path)
      return (result ? listedOf(result) : [])
        .flatMap((entry) => (entry.type === "directory" ? [withSlash(entry.path)] : []))
        .filter((folder) => !gitFolder.test(folder) && !dependencyFolder.test(folder) && !opened.includes(folder))
        .slice(0, aheadLimit)
    }),
  )
  const found = ChatReact.useFiles({ root, query: useDebouncedValue(query, searchDelay), type: "file" })
  const diff = ChatReact.useVcsDiff({ root, mode: "working", path: base })
  const prefetchFile = ChatReact.usePrefetchFile(root)
  const results = [...folders.results]
  const listed = [...results, ...ahead.results]
  const hits = query && AsyncResult.isSuccess(found) ? found.value.filter((entry) => entry.type === "file") : []
  const inside = (path: string) => path.startsWith(base) && path !== base && !gitFolder.test(path)
  const paths = [
    ...new Set([...pathsOf(listed.map(([, result]) => result)), ...hits.flatMap((entry) => lineageOf(entry.path))]),
  ]
    .filter(inside)
    .map((path) => path.slice(base.length))
  const gitStatus = AsyncResult.isSuccess(diff.result)
    ? diff.result.value.map((file) => ({ path: file.file, status: file.status }))
    : []
  useFolderFailures(results, folders.refresh)
  useRefreshOn(edited.length, () => {
    for (const path of new Set(edited.flatMap(foldersOf))) folders.refresh(path)
  })
  const top = folders.results.get("")
  return {
    base,
    topFolders: top ? listedOf(top).filter((entry) => entry.type === "directory").length : 0,
    root: folders.results.get(base),
    paths,
    opened: expanded.filter(inside).map((path) => path.slice(base.length)),
    gitStatus,
    setQuery,
    prefetch: (path: string) => prefetchFile(base + path),
    expand: (path: string) =>
      setExpanded((previous) => (previous.includes(base + path) ? previous : [...previous, base + path])),
    collapse: (path: string) => setExpanded((previous) => previous.filter((each) => each !== base + path)),
    reveal: (path: string) => setExpanded((previous) => revealIn(previous, path)),
    refreshFolder: (path: string) => folders.refresh(base + path),
    refresh: () => {
      for (const path of ["", base, ...expanded]) folders.refresh(path)
      diff.refresh()
    },
  }
}
