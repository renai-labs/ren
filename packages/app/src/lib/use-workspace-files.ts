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

export const pathsOf = (results: ReadonlyArray<AsyncResult.AsyncResult<Listed, unknown>>) =>
  results.flatMap((result) =>
    listedOf(result).map((entry) => (entry.type === "directory" ? withSlash(entry.path) : entry.path)),
  )

export function useFolderFailures(
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

export function useWorkspaceFiles(root: Session.ID, edited: ReadonlyArray<string>) {
  const [expanded, setExpanded] = useState<ReadonlyArray<string>>([])
  const [query, setQuery] = useState("")
  const folders = ChatReact.useFolders(root, expanded)
  const found = ChatReact.useFiles({ root, query: useDebouncedValue(query, searchDelay), type: "file" })
  const diff = ChatReact.useVcsDiff(root, "working")
  const refreshFolder = folders.refresh
  const results = [...folders.results]
  const hits = query && AsyncResult.isSuccess(found) ? found.value.filter((entry) => entry.type === "file") : []
  const paths = [
    ...new Set([...pathsOf(results.map(([, result]) => result)), ...hits.flatMap((entry) => lineageOf(entry.path))]),
  ]
  const loaded = results.flatMap(([path, result]) => (path && Option.isSome(AsyncResult.value(result)) ? [path] : []))
  const gitStatus = AsyncResult.isSuccess(diff.result)
    ? diff.result.value.map((file) => ({ path: file.file, status: file.status }))
    : []
  useFolderFailures(results, refreshFolder)
  useRefreshOn(edited.length, () => {
    for (const path of new Set(edited.flatMap(foldersOf))) refreshFolder(path)
  })
  return {
    root: folders.results.get(""),
    paths,
    loaded,
    gitStatus,
    setQuery,
    expand: (path: string) => setExpanded((previous) => (previous.includes(path) ? previous : [...previous, path])),
    reveal: (path: string) =>
      setExpanded((previous) => {
        const missing = ancestorsOf(path).filter((parent) => !previous.includes(parent))
        return missing.length > 0 ? [...previous, ...missing] : previous
      }),
    refreshFolder: folders.refresh,
    refresh: () => {
      for (const path of ["", ...expanded]) folders.refresh(path)
      diff.refresh()
    },
  }
}
