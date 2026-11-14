import { useState } from "react"
import type { ArtifactInfo } from "@ren/client"
import { FileTabs } from "@ren/chat"
import type { FileSystem } from "@ren/schema/file-system"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { FileName } from "@ren/util/file-name"
import { IconLinkOff } from "@tabler/icons-react"
import { useQueries, useQuery } from "@tanstack/react-query"
import { AsyncResult } from "effect/reactivity"
import { Artifacts } from "../lib/artifacts.js"
import { RouterContext } from "../lib/router-context.js"
import { ancestorsOf, pathsOf, useFolderFailures } from "../lib/use-workspace-files.js"
import { ArtifactMenu, ServingBadge, useArtifactActions } from "./artifact-gallery.js"
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

const artifactsFolder = "Artifacts"

function ArtifactPane(props: { artifact: ArtifactInfo }) {
  const actions = useArtifactActions()
  const artifact = props.artifact
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{Artifacts.host(artifact.url)}</span>
        <ServingBadge artifact={artifact} />
        <ArtifactMenu artifact={artifact} actions={actions} className="flex text-muted-foreground" />
      </div>
      {artifact.url ? (
        <iframe
          title={artifact.title}
          src={artifact.url}
          sandbox="allow-scripts allow-forms allow-popups"
          referrerPolicy="no-referrer"
          className="min-h-0 flex-1 border-0 bg-background"
        />
      ) : (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia className="text-muted-foreground [&_svg]:size-6">
              <IconLinkOff />
            </EmptyMedia>
            <EmptyTitle>{artifact.title} isn’t served</EmptyTitle>
            <EmptyDescription>It has no live link right now. Edit it with Ren to publish it again.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}

export function SourceFiles(props: { scope: Scope; empty: string }) {
  const { client } = RouterContext.useRouterContext()
  const drive = props.scope.source === "drive"
  const tree = useTree(props.scope)
  const artifacts = useQuery({ ...Artifacts.allOptions(client, props.scope.spaceId), enabled: drive })
  const [files, setFiles] = useState(FileTabs.empty)
  const current = files.tabs.find((tab) => tab.path === files.active)
  const byPath = (artifacts.data ?? []).reduce(
    (named, artifact) =>
      named.set(
        FileName.free(`${artifactsFolder}/${artifact.title.replaceAll("/", "-")}`, new Set(named.keys())),
        artifact,
      ),
    new Map<string, ArtifactInfo>(),
  )
  const artifact = current && byPath.get(current.path)
  return (
    <div className="flex min-h-96 flex-1 overflow-hidden rounded-lg border">
      <FileBrowser
        tree={
          drive
            ? {
                ...tree,
                paths: [...new Set([...tree.paths, `${artifactsFolder}/`, ...byPath.keys()])],
                pinned: [artifactsFolder],
              }
            : tree
        }
        files={files}
        onFiles={setFiles}
        onMention={undefined}
        onTerminal={undefined}
        empty={props.empty}
      >
        {artifact ? <ArtifactPane key={current.path} artifact={artifact} /> : null}
        {current && !artifact ? (
          <SourceFile key={current.path} scope={props.scope} tab={current} onFolder={tree.reveal} />
        ) : null}
      </FileBrowser>
    </div>
  )
}
