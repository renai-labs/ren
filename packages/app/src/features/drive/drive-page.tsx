import { useRef, useState } from "react"
import type { FileSystemAction, FileSystemEntry } from "@ren/client"
import { Button } from "@ren/ui/button"
import { FileIcon } from "@ren/ui/file-icon"
import { Input } from "@ren/ui/input"
import { Loading } from "@ren/ui/loading"
import { toast } from "@ren/ui/sonner"
import { formatDate } from "@ren/ui/time"
import { FileName } from "@ren/util/file-name"
import {
  IconBrowser,
  IconCube,
  IconDownload,
  IconFile,
  IconFolder,
  IconLock,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { DropOverlay } from "../../components/drop-overlay.js"
import { FileRow, FileTable, FileTableSample, rowLink } from "../../components/file-table.js"
import { Page, PageActions, TableEmpty, useShapeId } from "../../components/page.js"
import { RowMenu } from "../../components/row-menu.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { WorkspacePending } from "../../components/workspace-pending.js"
import { DriveSearch } from "../../lib/drive-search.js"
import { errorMessage } from "../../lib/errors.js"
import { formatBytes } from "../../lib/format.js"
import { QueryResult } from "../../lib/query-result.js"
import { RouterContext } from "../../lib/router-context.js"
import { Search } from "../../lib/search.js"
import { useDriveDownload } from "../../lib/use-drive-file.js"
import { maxFileBytes } from "../../lib/use-uploads.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { DriveCrumbs } from "./drive-crumbs.js"
import { DriveLink } from "./drive-link.js"
import { DriveViewer } from "./drive-viewer.js"

const route = getRouteApi("/_authed/_shell/drive/")

const spaceRoute = getRouteApi("/_authed/_shell/spaces/$spaceId/drive/")

const org = { kind: "org" } as const

const columns = [
  { label: "Date modified", className: "w-44" },
  { label: "File size", className: "w-32" },
]

const blank = ["—", "—"]

function Upload(props: {
  space: string | undefined
  folder: string
  actions: ReadonlyArray<FileSystemAction>
  taken: ReadonlySet<string>
  onDone: () => void
}) {
  const { client, platform } = RouterContext.useRouterContext()
  const picker = useRef<HTMLInputElement>(null)
  const send = platform.upload
  if (!send || !props.actions.includes("upload")) return null
  const upload = (incoming: ReadonlyArray<File>) => {
    const large = incoming.filter((file) => file.size > maxFileBytes)
    if (large.length > 0)
      toast.error(large.length === 1 ? `${large.at(0)?.name ?? "A file"} is too large` : "Some files are too large", {
        description: `A file can be at most ${formatBytes(maxFileBytes)}.`,
      })
    const names = new Set(props.taken)
    const named = incoming
      .filter((file) => file.size <= maxFileBytes)
      .map((file) => {
        const path = FileName.free(`${props.folder}${file.name}`, names)
        names.add(path)
        return { file, path }
      })
    for (const each of named) {
      const id = toast.loading(`Uploading ${FileName.base(each.path)}`)
      void client.drive
        .startUpload({ ...(props.space && { spaceId: props.space }), path: each.path, size: each.file.size })
        .then((form) => send(form, each.file, new AbortController().signal))
        .then(
          () => {
            toast.success(`${FileName.base(each.path)} uploaded`, { id })
            props.onDone()
          },
          (error: unknown) =>
            toast.error(`Could not upload ${FileName.base(each.path)}`, { id, description: errorMessage(error) }),
        )
    }
  }
  return (
    <>
      <PageActions>
        <Button onClick={() => picker.current?.click()}>
          <IconUpload data-icon="inline-start" />
          Upload
        </Button>
      </PageActions>
      <DropOverlay
        title="Drop files to upload"
        detail={`Into ${props.folder || "the top folder"}, up to ${formatBytes(maxFileBytes)} each`}
        onFiles={upload}
      />
      <Input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          upload([...(event.target.files ?? [])])
          event.target.value = ""
        }}
      />
    </>
  )
}

function PinnedRows(props: { home: DriveSearch.Home; space: string | undefined; query: string }) {
  const spaces = useSpaces()
  return (
    <>
      {Search.matches(props.query, "Artifacts") ? (
        <FileRow
          media={<IconBrowser />}
          name={
            <DriveLink home={props.home} page="artifacts" space={props.space} className={rowLink}>
              Artifacts
            </DriveLink>
          }
          cells={blank}
        />
      ) : null}
      {props.home.kind === "org" && !props.space
        ? spaces.joined
            .filter((space) => Search.matches(props.query, space.name))
            .map((space) => (
              <FileRow
                key={space.id}
                media={space.kind === "private" ? <IconLock /> : <IconCube />}
                name={
                  <DriveLink home={org} page="files" space={space.id} className={rowLink}>
                    {space.name}
                  </DriveLink>
                }
                cells={blank}
              />
            ))
        : null}
    </>
  )
}

function EntryRow(props: {
  home: DriveSearch.Home
  entry: FileSystemEntry
  space: string | undefined
  folder: string
  actions: ReadonlyArray<FileSystemAction>
}) {
  const { api } = RouterContext.useRouterContext()
  const remove = useMutation(api.files.delete.mutationOptions())
  const download = useDriveDownload(props.space)
  const entry = props.entry
  const name = FileName.base(entry.path)
  if (entry.type === "directory")
    return (
      <FileRow
        media={<IconFolder />}
        name={
          <DriveLink home={props.home} page="files" space={props.space} folder={entry.path} className={rowLink}>
            {name}
          </DriveLink>
        }
        cells={blank}
      />
    )
  return (
    <FileRow
      media={<FileIcon name={name} mime={entry.mime} />}
      name={
        <DriveLink
          home={props.home}
          page="files"
          space={props.space}
          folder={props.folder || undefined}
          file={entry.path}
          className={rowLink}
        >
          {name}
        </DriveLink>
      }
      cells={[
        entry.modifiedAt ? formatDate(entry.modifiedAt) : "—",
        entry.size === undefined ? "—" : formatBytes(entry.size),
      ]}
      menu={
        <RowMenu
          label={`${name} actions`}
          className="flex text-muted-foreground"
          items={[
            {
              label: "Download",
              icon: IconDownload,
              onSelect: () =>
                download(entry.path).then(undefined, (error: unknown) =>
                  toast.error(`Could not download ${name}`, { description: errorMessage(error) }),
                ),
            },
            ...(props.actions.includes("remove")
              ? [
                  {
                    label: "Delete",
                    icon: IconTrash,
                    onSelect: () =>
                      remove
                        .mutateAsync({
                          source: "drive",
                          ...(props.space && { spaceId: props.space }),
                          path: entry.path,
                        })
                        .then(
                          () => toast.success(`${name} deleted`),
                          (error: unknown) =>
                            toast.error("Could not delete the file", { description: errorMessage(error) }),
                        ),
                    confirm: {
                      title: `Delete ${name}?`,
                      description: "It leaves the drive for everyone, and you can’t undo this.",
                      action: "Delete",
                    },
                  },
                ]
              : []),
          ]}
        />
      }
    />
  )
}

function Listing(props: { home: DriveSearch.Home; space: string | undefined; folder: string; query: string }) {
  const { api } = RouterContext.useRouterContext()
  const listed = useQuery(api.files.list.queryOptions(DriveSearch.listInput(props)))
  const shapeId = useShapeId("drive-files")
  const data = listed.data
  const shown = (data?.entries ?? []).filter((entry) => Search.matches(props.query, FileName.base(entry.path)))
  if (listed.error && !data)
    return (
      <WorkspacePending
        result={QueryResult.of(listed)}
        icon={<IconFile />}
        title="Could not open this folder"
        onRetry={() => void listed.refetch()}
      />
    )
  return (
    <Loading id={shapeId} loading={!data} label="Loading files">
      {data ? (
        <FileTable columns={columns}>
          {props.folder ? null : <PinnedRows home={props.home} space={props.space} query={props.query} />}
          {shown.length === 0 ? (
            <TableEmpty columns={columns.length + 2}>
              {Search.empty(props.query, props.folder ? "This folder is empty." : "No files yet.")}
            </TableEmpty>
          ) : null}
          {shown.map((entry) => (
            <EntryRow
              key={entry.path}
              home={props.home}
              entry={entry}
              space={props.space}
              folder={props.folder}
              actions={data.actions}
            />
          ))}
        </FileTable>
      ) : (
        <FileTableSample columns={columns} count={6} />
      )}
    </Loading>
  )
}

function DriveFiles(props: {
  home: DriveSearch.Home
  space: string | undefined
  folder: string
  file: string | undefined
}) {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const listed = useQuery(api.files.list.queryOptions(DriveSearch.listInput(props)))
  const [query, setQuery] = useState("")
  const data = listed.data
  return (
    <>
      <PageActions>
        <ToolbarSearch
          label={props.space || props.folder ? "Search this folder" : "Search Drive"}
          value={query}
          onChange={setQuery}
        />
      </PageActions>
      <Upload
        space={props.space}
        folder={props.folder}
        actions={data?.actions ?? []}
        taken={new Set(data?.entries.map((entry) => entry.path))}
        onDone={() => void listed.refetch()}
      />
      <Listing home={props.home} space={props.space} folder={props.folder} query={query} />
      {props.file && data ? (
        <DriveViewer
          space={props.space}
          path={props.file}
          entry={data.entries.find((entry) => entry.path === props.file)}
          onClose={() => void navigate({ to: ".", search: (previous) => ({ ...previous, file: undefined }) })}
          onFolder={(folder) =>
            void navigate({ to: ".", search: (previous) => ({ ...previous, folder, file: undefined }) })
          }
        />
      ) : null}
    </>
  )
}

export function DrivePage() {
  const search = route.useSearch()
  return (
    <Page title="Drive" width="full" leading={<DriveCrumbs home={org} space={search.space} folder={search.folder} />}>
      <DriveFiles
        key={`${search.space ?? ""}:${search.folder ?? ""}`}
        home={org}
        space={search.space}
        folder={search.folder ?? ""}
        file={search.file}
      />
    </Page>
  )
}

export function SpaceDrivePage() {
  const spaceId = spaceRoute.useParams({ select: (params) => params.spaceId })
  const search = spaceRoute.useSearch()
  const home = { kind: "space", spaceId } as const
  return (
    <>
      <DriveCrumbs home={home} space={spaceId} folder={search.folder} />
      <DriveFiles
        key={search.folder ?? ""}
        home={home}
        space={spaceId}
        folder={search.folder ?? ""}
        file={search.file}
      />
    </>
  )
}
