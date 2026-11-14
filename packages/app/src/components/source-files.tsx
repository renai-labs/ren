import { useRef, useState } from "react"
import type { ArtifactInfo } from "@ren/client"
import { FileTabs } from "@ren/chat"
import type { FileSystem } from "@ren/schema/file-system"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { FileName } from "@ren/util/file-name"
import { Button } from "@ren/ui/button"
import { Input } from "@ren/ui/input"
import { toast } from "@ren/ui/sonner"
import { IconLinkOff, IconUpload } from "@tabler/icons-react"
import { useMutation, useQueries, useQuery } from "@tanstack/react-query"
import { AsyncResult } from "effect/reactivity"
import { Artifacts } from "../lib/artifacts.js"
import { errorMessage } from "../lib/errors.js"
import { formatBytes } from "../lib/format.js"
import { RouterContext } from "../lib/router-context.js"
import { maxFileBytes } from "../lib/use-uploads.js"
import { ancestorsOf, pathsOf, useFolderFailures } from "../lib/use-workspace-files.js"
import { ArtifactMenu, ServingBadge, useArtifactActions } from "./artifact-gallery.js"
import { ConfirmDialog } from "./confirm-dialog.js"
import { DropOverlay } from "./drop-overlay.js"
import { FileBrowser, OpenFile } from "./file-browser.js"
import { PageActions } from "./page.js"

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
    actions: queries[0]?.data?.actions ?? [],
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

const nameOf = (path: string) => path.split("/").at(-1) ?? path

function useUpload(scope: Scope, onDone: (folder: string) => void) {
  const { client, platform } = RouterContext.useRouterContext()
  const send = platform.upload
  if (!send) return
  return (folder: string, incoming: ReadonlyArray<File>, taken: ReadonlySet<string>) => {
    const large = incoming.filter((file) => file.size > maxFileBytes)
    if (large.length > 0)
      toast.error(large.length === 1 ? `${large.at(0)?.name ?? "A file"} is too large` : "Some files are too large", {
        description: `A file can be at most ${formatBytes(maxFileBytes)}.`,
      })
    const names = new Set(taken)
    const named = incoming
      .filter((file) => file.size <= maxFileBytes)
      .map((file) => {
        const path = FileName.free(`${folder}${file.name}`, names)
        names.add(path)
        return { file, path }
      })
    for (const each of named) {
      const id = toast.loading(`Uploading ${nameOf(each.path)}`)
      void client.drive
        .startUpload({ ...(scope.spaceId && { spaceId: scope.spaceId }), path: each.path, size: each.file.size })
        .then((form) => send(form, each.file, new AbortController().signal))
        .then(
          () => {
            toast.success(`${nameOf(each.path)} uploaded`, { id })
            onDone(folder)
          },
          (error: unknown) =>
            toast.error(`Could not upload ${nameOf(each.path)}`, { id, description: errorMessage(error) }),
        )
    }
  }
}

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

function useArtifactTree(scope: Scope, tree: ReturnType<typeof useTree>) {
  const { client } = RouterContext.useRouterContext()
  const drive = scope.source === "drive"
  const artifacts = useQuery({ ...Artifacts.allOptions(client, scope.spaceId), enabled: drive })
  const byPath = (artifacts.data ?? []).reduce(
    (named, artifact) =>
      named.set(
        FileName.free(`${artifactsFolder}/${artifact.title.replaceAll("/", "-")}`, new Set(named.keys())),
        artifact,
      ),
    new Map<string, ArtifactInfo>(),
  )
  if (!drive) return { tree, byPath }
  return {
    tree: {
      ...tree,
      paths: [...new Set([...tree.paths, `${artifactsFolder}/`, ...byPath.keys()])],
      pinned: [artifactsFolder],
    },
    byPath,
  }
}

function UploadControls(props: { folder: string; onPick: () => void; onFiles: (files: ReadonlyArray<File>) => void }) {
  return (
    <>
      <PageActions>
        <Button onClick={props.onPick}>
          <IconUpload data-icon="inline-start" />
          Upload
        </Button>
      </PageActions>
      <DropOverlay
        title="Drop files to upload"
        detail={`Into ${props.folder || "the top folder"}, up to ${formatBytes(maxFileBytes)} each`}
        onFiles={props.onFiles}
      />
    </>
  )
}

function DeleteDialog(props: {
  scope: Scope
  path: string | undefined
  onClose: () => void
  onDeleted: (path: string) => void
}) {
  const { api } = RouterContext.useRouterContext()
  const remove = useMutation(api.files.delete.mutationOptions())
  const path = props.path ?? ""
  return (
    <ConfirmDialog
      open={props.path !== undefined}
      onOpenChange={(open) => (open ? undefined : props.onClose())}
      confirmation={{
        title: `Delete ${nameOf(path)}?`,
        description: `It leaves the ${props.scope.source} for everyone, and you can’t undo this.`,
        action: "Delete",
      }}
      onConfirm={() =>
        remove.mutateAsync({ ...props.scope, path }).then(
          () => props.onDeleted(path),
          (error: unknown) => toast.error("Could not delete the file", { description: errorMessage(error) }),
        )
      }
    />
  )
}

export function SourceFiles(props: { scope: Scope; empty: string }) {
  const listed = useTree(props.scope)
  const shown = useArtifactTree(props.scope, listed)
  const upload = useUpload(props.scope, listed.refreshFolder)
  const picker = useRef<HTMLInputElement>(null)
  const [target, setTarget] = useState("")
  const [deleting, setDeleting] = useState<string>()
  const [files, setFiles] = useState(FileTabs.empty)
  const current = files.tabs.find((tab) => tab.path === files.active)
  const artifact = current && shown.byPath.get(current.path)
  const folder = current && !artifact ? (ancestorsOf(current.path).at(-1) ?? "") : ""
  const send = listed.actions.includes("upload") ? upload : undefined
  const pick = (into: string) => {
    setTarget(into)
    picker.current?.click()
  }
  return (
    <div className="flex min-h-96 flex-1 overflow-hidden rounded-lg border">
      {send ? (
        <UploadControls
          folder={folder}
          onPick={() => pick(folder)}
          onFiles={(incoming) => send(folder, incoming, new Set(listed.paths))}
        />
      ) : null}
      <Input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          send?.(target, [...(event.target.files ?? [])], new Set(listed.paths))
          event.target.value = ""
        }}
      />
      <FileBrowser
        tree={shown.tree}
        files={files}
        onFiles={setFiles}
        onMention={undefined}
        onTerminal={undefined}
        onUpload={send ? pick : undefined}
        onDelete={listed.actions.includes("remove") ? setDeleting : undefined}
        empty={props.empty}
      >
        {artifact ? <ArtifactPane key={current.path} artifact={artifact} /> : null}
        {current && !artifact ? (
          <SourceFile key={current.path} scope={props.scope} tab={current} onFolder={listed.reveal} />
        ) : null}
      </FileBrowser>
      <DeleteDialog
        scope={props.scope}
        path={deleting}
        onClose={() => setDeleting(undefined)}
        onDeleted={(path) => setFiles((previous) => FileTabs.close(previous, path))}
      />
    </div>
  )
}
