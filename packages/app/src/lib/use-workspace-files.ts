import { useEffect, useState } from "react"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionCatalog } from "@ren/schema/session/catalog"
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

const listedOf = (result: AsyncResult.AsyncResult<ReadonlyArray<SessionCatalog.File>, unknown>) =>
  Option.getOrElse(AsyncResult.value(result), () => [])

export type WorkspaceFiles = ReturnType<typeof useWorkspaceFiles>

export function useWorkspaceFiles(root: Session.ID, edited: ReadonlyArray<string>) {
  const [expanded, setExpanded] = useState<ReadonlyArray<string>>([])
  const [query, setQuery] = useState("")
  const folders = ChatReact.useFolders(root, expanded)
  const found = ChatReact.useFiles({ root, query: useDebouncedValue(query, searchDelay), type: "file" })
  const diff = ChatReact.useVcsDiff(root, "working")
  const refreshFolder = folders.refresh
  const refreshDiff = diff.refresh
  const results = [...folders.results]
  const hits = query && AsyncResult.isSuccess(found) ? found.value.filter((entry) => entry.type === "file") : []
  const failures = results.flatMap(([path, result]) => (path && AsyncResult.isFailure(result) ? [path] : [])).join("\n")
  useEffect(() => {
    for (const path of failures.split("\n").filter(Boolean))
      toast.error("Could not list the files", {
        id: path,
        description: path,
        action: { label: "Retry", onClick: () => refreshFolder(path) },
      })
  }, [failures, refreshFolder])
  useRefreshOn(edited.length, () => {
    for (const path of new Set(edited.flatMap(foldersOf))) refreshFolder(path)
    refreshDiff()
  })
  return {
    root: folders.results.get(""),
    paths: [
      ...new Set([
        ...results.flatMap(([, result]) =>
          listedOf(result).map((entry) => (entry.type === "directory" ? withSlash(entry.path) : entry.path)),
        ),
        ...hits.flatMap((entry) => lineageOf(entry.path)),
      ]),
    ],
    loaded: results.flatMap(([path, result]) => (path && Option.isSome(AsyncResult.value(result)) ? [path] : [])),
    gitStatus: AsyncResult.isSuccess(diff.result)
      ? diff.result.value.map((file) => ({ path: file.file, status: file.status }))
      : [],
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
