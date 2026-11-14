import { useState } from "react"
import type { FileSystemAction, FileSystemEntry } from "@ren/client"
import { Memory } from "@ren/schema/memory"
import { Badge } from "@ren/ui/badge"
import { FileIcon } from "@ren/ui/file-icon"
import { Loading } from "@ren/ui/loading"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@ren/ui/sheet"
import { toast } from "@ren/ui/sonner"
import { FileName } from "@ren/util/file-name"
import { IconFile, IconFolder, IconTrash } from "@tabler/icons-react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { errorMessage } from "../lib/errors.js"
import { formatBytes } from "../lib/format.js"
import { QueryResult } from "../lib/query-result.js"
import { RouterContext } from "../lib/router-context.js"
import { Search } from "../lib/search.js"
import { ancestorsOf } from "../lib/use-workspace-files.js"
import { Breadcrumb } from "./breadcrumb.js"
import { FileRow, FileTable, FileTableSample, rowLink } from "./file-table.js"
import { MemoryFile, NewMemoryFile, type Scope } from "./memory-file.js"
import { PageActions, TableEmpty, useShapeId } from "./page.js"
import { RowMenu } from "./row-menu.js"
import { ToolbarSearch } from "./toolbar-search.js"
import { WorkspacePending } from "./workspace-pending.js"

const columns = [{ label: "File size", className: "w-32" }]

function Crumbs(props: { folder: string }) {
  const parts = props.folder.split("/").filter(Boolean)
  if (parts.length === 0) return null
  const ancestors = [
    { key: "", label: "Memory" },
    ...parts.slice(0, -1).map((part, index) => ({ key: `${parts.slice(0, index + 1).join("/")}/`, label: part })),
  ]
  return (
    <Breadcrumb.Root
      ancestors={ancestors.map((crumb) => ({
        key: crumb.key,
        content: (
          <Link to="." search={{ folder: crumb.key || undefined }} className="transition-colors hover:text-foreground">
            {crumb.label}
          </Link>
        ),
      }))}
    >
      <span className="font-medium">{parts.at(-1)}</span>
    </Breadcrumb.Root>
  )
}

function EntryRow(props: {
  scope: Scope
  entry: FileSystemEntry
  folder: string
  actions: ReadonlyArray<FileSystemAction>
}) {
  const { api } = RouterContext.useRouterContext()
  const remove = useMutation(api.files.delete.mutationOptions())
  const entry = props.entry
  const name = FileName.base(entry.path)
  if (entry.type === "directory")
    return (
      <FileRow
        media={<IconFolder />}
        name={
          <Link to="." search={{ folder: entry.path }} className={rowLink}>
            {name}
          </Link>
        }
        cells={["—"]}
      />
    )
  return (
    <FileRow
      media={<FileIcon name={name} mime={entry.mime} />}
      name={
        <Link to="." search={{ folder: props.folder || undefined, file: entry.path }} className={rowLink}>
          {name}
        </Link>
      }
      badge={
        entry.path === Memory.root ? (
          <Badge variant="secondary" className="shrink-0">
            In every chat
          </Badge>
        ) : null
      }
      cells={[entry.size === undefined ? "—" : formatBytes(entry.size)]}
      menu={
        props.actions.includes("remove") ? (
          <RowMenu
            label={`${name} actions`}
            className="flex text-muted-foreground"
            items={[
              {
                label: "Delete",
                icon: IconTrash,
                onSelect: () =>
                  remove.mutateAsync({ ...props.scope, path: entry.path }).then(
                    () => toast.success(`${name} deleted`),
                    (error: unknown) => toast.error("Could not delete the file", { description: errorMessage(error) }),
                  ),
                confirm: {
                  title: `Delete ${name}?`,
                  description: "Agents stop remembering what it says, and you can’t undo this.",
                  action: "Delete",
                },
              },
            ]}
          />
        ) : null
      }
    />
  )
}

function Listing(props: { scope: Scope; folder: string; query: string }) {
  const { api } = RouterContext.useRouterContext()
  const listed = useQuery(
    api.files.list.queryOptions({ ...props.scope, ...(props.folder && { folder: props.folder }) }),
  )
  const shapeId = useShapeId("memory-files")
  const data = listed.data
  const shown = (data?.entries ?? [])
    .filter((entry) => Search.matches(props.query, FileName.base(entry.path)))
    .toSorted((a, b) => Number(b.path === Memory.root) - Number(a.path === Memory.root))
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
    <Loading id={shapeId} loading={!data} label="Loading memory">
      {data ? (
        <FileTable columns={columns}>
          {shown.length === 0 ? (
            <TableEmpty columns={columns.length + 2}>
              {Search.empty(props.query, props.folder ? "This folder is empty." : "Nothing remembered yet.")}
            </TableEmpty>
          ) : null}
          {shown.map((entry) => (
            <EntryRow key={entry.path} scope={props.scope} entry={entry} folder={props.folder} actions={data.actions} />
          ))}
        </FileTable>
      ) : (
        <FileTableSample columns={columns} count={4} />
      )}
    </Loading>
  )
}

export function MemoryFiles(props: { spaceId?: string | undefined; folder: string; file: string | undefined }) {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const scope: Scope = { source: "memory", ...(props.spaceId && { spaceId: props.spaceId }) }
  const listed = useQuery(api.files.list.queryOptions({ ...scope, ...(props.folder && { folder: props.folder }) }))
  const [query, setQuery] = useState("")
  const actions = listed.data?.actions ?? []
  return (
    <>
      <PageActions>
        <ToolbarSearch
          label={props.folder ? "Search this folder" : "Search memory"}
          value={query}
          onChange={setQuery}
        />
      </PageActions>
      <NewMemoryFile
        scope={scope}
        actions={actions}
        onOpen={(path) => void navigate({ to: ".", search: { folder: ancestorsOf(path).at(-1), file: path } })}
      />
      <Crumbs folder={props.folder} />
      <Listing scope={scope} folder={props.folder} query={query} />
      {props.file ? (
        <Sheet
          open
          onOpenChange={(open) =>
            open ? undefined : void navigate({ to: ".", search: { folder: props.folder || undefined } })
          }
        >
          <SheetContent className="data-[side=right]:sm:max-w-3xl">
            <SheetHeader>
              <SheetTitle className="flex min-w-0 items-center gap-2 pr-8">
                <FileIcon name={props.file} />
                <span className="truncate">{props.file}</span>
              </SheetTitle>
              <SheetDescription className="sr-only">Read and edit {props.file}</SheetDescription>
            </SheetHeader>
            <MemoryFile scope={scope} path={props.file} actions={actions} />
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  )
}
