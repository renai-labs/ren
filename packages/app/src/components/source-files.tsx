import { useRef, useState } from "react"
import { FileTabs } from "@ren/chat"
import { Memory } from "@ren/schema/memory"
import { Button } from "@ren/ui/button"
import { Input } from "@ren/ui/input"
import { toast } from "@ren/ui/sonner"
import { FileName } from "@ren/util/file-name"
import { IconUpload } from "@tabler/icons-react"
import { useMutation, useQueries, useQuery } from "@tanstack/react-query"
import { AsyncResult } from "effect/reactivity"
import { Artifacts } from "../lib/artifacts.js"
import { errorMessage } from "../lib/errors.js"
import { formatBytes } from "../lib/format.js"
import { RouterContext } from "../lib/router-context.js"
import { maxFileBytes } from "../lib/use-uploads.js"
import { useSpaces } from "../lib/use-spaces.js"
import { ancestorsOf, pathsOf, useFolderFailures } from "../lib/use-workspace-files.js"
import { ConfirmDialog } from "./confirm-dialog.js"
import { DropOverlay } from "./drop-overlay.js"
import { FileBrowser } from "./file-browser.js"
import { PageActions } from "./page.js"
import { NewMemoryFile, Pane, resultOf, type Scope } from "./source-panes.js"

export type Pin = "artifacts" | "spaces" | "memory"

type Root = { readonly prefix: string; readonly scope: Scope }

type Roots = readonly [Root, ...ReadonlyArray<Root>]

const artifactsFolder = "Artifacts"
const spacesFolder = "Spaces"
const memoryFolder = "Org memory"

const nameOf = (path: string) => path.split("/").at(-1) ?? path

const clean = (name: string) => name.replaceAll("/", "-") || "Untitled"

const freeNames = <A,>(folder: string, entries: ReadonlyArray<readonly [string, A]>) =>
  entries.reduce(
    (named, entry) => named.set(FileName.free(`${folder}/${clean(entry[0])}`, new Set(named.keys())), entry[1]),
    new Map<string, A>(),
  )

const rootOf = (roots: Roots, path: string) =>
  roots.reduce(
    (best, root) => (path.startsWith(root.prefix) && root.prefix.length > best.prefix.length ? root : best),
    roots[0],
  )

function useRoots(scope: Scope, pins: ReadonlyArray<Pin>): Roots {
  const spaces = useSpaces().joined
  const named = freeNames(
    spacesFolder,
    pins.includes("spaces") ? spaces.map((space) => [space.name, space.id] as const) : [],
  )
  return [
    { prefix: "", scope },
    ...[...named].map((entry): Root => ({ prefix: `${entry[0]}/`, scope: { source: "drive", spaceId: entry[1] } })),
    ...(pins.includes("memory") ? [{ prefix: `${memoryFolder}/`, scope: { source: "memory" } } as const] : []),
  ]
}

function useArtifacts(scope: Scope, pins: ReadonlyArray<Pin>) {
  const { client } = RouterContext.useRouterContext()
  const artifacts = useQuery({ ...Artifacts.allOptions(client, scope.spaceId), enabled: pins.includes("artifacts") })
  return freeNames(
    artifactsFolder,
    (artifacts.data ?? []).map((artifact) => [artifact.title, artifact] as const),
  )
}

function useTree(roots: Roots, virtual: ReadonlyArray<string>) {
  const { api } = RouterContext.useRouterContext()
  const [expanded, setExpanded] = useState<ReadonlyArray<string>>([])
  const folders = ["", ...expanded.filter((path) => !virtual.includes(path))].map((path) => ({
    path,
    root: rootOf(roots, path),
  }))
  const queries = useQueries({
    queries: folders.map((each) => {
      const folder = each.path.slice(each.root.prefix.length)
      return api.files.list.queryOptions({ ...each.root.scope, ...(folder && { folder }) })
    }),
  })
  const results = folders.map((each, index) => {
    const query = queries[index]
    const data = query?.data && {
      entries: query.data.entries.map((entry) => ({ path: `${each.root.prefix}${entry.path}`, type: entry.type })),
    }
    return [each.path, resultOf({ data, error: query?.error ?? null })] as const
  })
  const refreshFolder = (path: string) => void queries[folders.findIndex((each) => each.path === path)]?.refetch()
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

function useMounts(scope: Scope, pins: ReadonlyArray<Pin>) {
  const roots = useRoots(scope, pins)
  const artifacts = useArtifacts(scope, pins)
  const virtual = [
    ...(pins.includes("artifacts") ? [`${artifactsFolder}/`] : []),
    ...(pins.includes("spaces") ? [`${spacesFolder}/`] : []),
  ]
  return {
    roots,
    artifacts,
    virtual,
    paths: [...virtual, ...roots.flatMap((each) => each.prefix || []), ...artifacts.keys()],
    pinned: [
      ...virtual.map((path) => path.slice(0, -1)),
      ...(pins.includes("memory") ? [memoryFolder] : []),
      ...(scope.source === "memory" ? [Memory.root] : []),
    ],
  }
}

const uploadFolder = (mounts: ReturnType<typeof useMounts>, path: string | undefined) =>
  path === undefined || mounts.artifacts.has(path) || rootOf(mounts.roots, path).prefix
    ? ""
    : (ancestorsOf(path).at(-1) ?? "")

function OpenPane(props: {
  tab: FileTabs.Tab
  mounts: ReturnType<typeof useMounts>
  onFolder: (folder: string) => void
}) {
  const root = rootOf(props.mounts.roots, props.tab.path)
  return (
    <Pane
      artifact={props.mounts.artifacts.get(props.tab.path)}
      scope={root.scope}
      path={props.tab.path.slice(root.prefix.length)}
      tab={props.tab}
      onFolder={(folder) => props.onFolder(`${root.prefix}${folder}`)}
    />
  )
}

export function SourceFiles(props: { scope: Scope; pins: ReadonlyArray<Pin>; empty: string }) {
  const mounts = useMounts(props.scope, props.pins)
  const listed = useTree(mounts.roots, mounts.virtual)
  const upload = useUpload(props.scope, listed.refreshFolder)
  const picker = useRef<HTMLInputElement>(null)
  const [target, setTarget] = useState("")
  const [deleting, setDeleting] = useState<string>()
  const [files, setFiles] = useState(FileTabs.empty)
  const current = files.tabs.find((tab) => tab.path === files.active)
  const folder = uploadFolder(mounts, current?.path)
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
      <NewMemoryFile
        scope={props.scope}
        actions={listed.actions}
        taken={listed.paths}
        onCreated={(path) => {
          listed.reveal(path)
          setFiles((previous) => FileTabs.open(previous, path, { pin: true }))
        }}
      />
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
        tree={{
          ...listed,
          paths: [...new Set([...listed.paths, ...mounts.paths])],
          loaded: [...listed.loaded, ...mounts.virtual],
          pinned: mounts.pinned,
        }}
        files={files}
        onFiles={setFiles}
        onMention={undefined}
        onTerminal={undefined}
        onUpload={send ? pick : undefined}
        onDelete={listed.actions.includes("remove") ? setDeleting : undefined}
        empty={props.empty}
      >
        {current ? <OpenPane key={current.path} tab={current} mounts={mounts} onFolder={listed.reveal} /> : null}
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
