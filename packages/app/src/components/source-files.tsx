import { useState } from "react"
import { FileTabs } from "@ren/chat"
import type { FileSystem } from "@ren/schema/file-system"
import { useQueries, useQuery } from "@tanstack/react-query"
import { AsyncResult } from "effect/reactivity"
import { RouterContext } from "../lib/router-context.js"
import { ancestorsOf, pathsOf, useFolderFailures } from "../lib/use-workspace-files.js"
import { FileBrowser, OpenFile } from "./file-browser.js"

type Scope = { readonly source: FileSystem.Source; readonly spaceId?: string | undefined }

const resultOf = <A,>(query: { readonly data: A | undefined; readonly error: unknown }) => {
  if (query.data !== undefined) return AsyncResult.success<A, unknown>(query.data)
  return query.error ? AsyncResult.fail<unknown, A>(query.error) : AsyncResult.initial<A, unknown>(true)
}

function useTree(scope: Scope) {
  const { api } = RouterContext.useRouterContext()
  const [expanded, setExpanded] = useState<ReadonlyArray<string>>([])
  const folders = ["", ...expanded]
  const queries = useQueries({
    queries: folders.map((folder) => api.files.list.queryOptions({ ...scope, ...(folder && { folder }) })),
  })
  const results = folders.map(
    (folder, index) => [folder, resultOf(queries[index] ?? { data: undefined, error: null })] as const,
  )
  const refreshFolder = (path: string) => void queries[folders.indexOf(path)]?.refetch()
  useFolderFailures(results, refreshFolder)
  return {
    root: results[0]?.[1],
    paths: [...new Set(pathsOf(results.map((entry) => entry[1])))],
    loaded: results.flatMap(([path, result]) => (path && AsyncResult.isSuccess(result) ? [path] : [])),
    gitStatus: [],
    setQuery: () => undefined,
    expand: (path: string) => setExpanded((previous) => (previous.includes(path) ? previous : [...previous, path])),
    reveal: (path: string) =>
      setExpanded((previous) => {
        const missing = ancestorsOf(path).filter((parent) => !previous.includes(parent))
        return missing.length > 0 ? [...previous, ...missing] : previous
      }),
    refreshFolder,
    refresh: () => {
      for (const query of queries) void query.refetch()
    },
  }
}

function SourceFile(props: { scope: Scope; tab: FileTabs.Tab; onFolder: (folder: string) => void }) {
  const { api } = RouterContext.useRouterContext()
  const query = useQuery(api.files.read.queryOptions({ ...props.scope, path: props.tab.path }))
  return (
    <OpenFile
      read={{ result: resultOf(query), refresh: () => void query.refetch() }}
      tab={props.tab}
      onFolder={props.onFolder}
      onMention={undefined}
    />
  )
}

export function SourceFiles(props: { scope: Scope; empty: string }) {
  const tree = useTree(props.scope)
  const [files, setFiles] = useState(FileTabs.empty)
  const current = files.tabs.find((tab) => tab.path === files.active)
  return (
    <div className="flex min-h-96 flex-1 overflow-hidden rounded-lg border">
      <FileBrowser
        tree={tree}
        files={files}
        onFiles={setFiles}
        onMention={undefined}
        onTerminal={undefined}
        empty={props.empty}
      >
        {current ? <SourceFile key={current.path} scope={props.scope} tab={current} onFolder={tree.reveal} /> : null}
      </FileBrowser>
    </div>
  )
}
