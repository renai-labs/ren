import { useState } from "react"
import type { ArtifactInfo } from "@ren/client"
import type { FileTabs } from "@ren/chat"
import type { FileSystem } from "@ren/schema/file-system"
import { Memory } from "@ren/schema/memory"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Field, FieldError, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { IconFile, IconLinkOff, IconPlus } from "@tabler/icons-react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { AsyncResult } from "effect/reactivity"
import { Artifacts } from "../lib/artifacts.js"
import { errorMessage } from "../lib/errors.js"
import { formatCount, formText } from "../lib/format.js"
import { RouterContext } from "../lib/router-context.js"
import { ArtifactMenu, ServingBadge, useArtifactActions } from "./artifact-actions.js"
import { OpenFile } from "./file-browser.js"
import { InstructionsField } from "./instructions-field.js"
import { PageActions } from "./page.js"
import { WorkspacePending } from "./workspace-pending.js"

export type Scope = { readonly source: FileSystem.Source; readonly spaceId?: string | undefined }

export const resultOf = <A,>(query: { readonly data: A | undefined; readonly error: unknown }) => {
  if (query.data !== undefined) return AsyncResult.success<A, unknown>(query.data)
  return query.error ? AsyncResult.fail<unknown, A>(query.error) : AsyncResult.initial<A, unknown>(true)
}

const writeScope = (scope: Scope) => (scope.spaceId ? { spaceId: scope.spaceId } : {})

function DriveFile(props: { scope: Scope; path: string; tab: FileTabs.Tab; onFolder: (folder: string) => void }) {
  const { api } = RouterContext.useRouterContext()
  const query = useQuery(api.files.read.queryOptions({ ...props.scope, path: props.path }))
  return (
    <OpenFile
      read={{ result: resultOf(query), refresh: () => void query.refetch() }}
      tab={props.tab}
      onFolder={props.onFolder}
      onMention={undefined}
    />
  )
}

function MemoryFile(props: { scope: Scope; path: string }) {
  const { api } = RouterContext.useRouterContext()
  const query = useQuery(api.files.read.queryOptions({ ...props.scope, path: props.path }))
  const folder = useQuery(api.files.list.queryOptions(props.scope))
  const write = useMutation(api.memory.write.mutationOptions())
  if (query.data === undefined)
    return (
      <WorkspacePending
        result={resultOf(query)}
        icon={<IconFile />}
        title="Could not open the file"
        onRetry={() => void query.refetch()}
      />
    )
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
      {props.path === Memory.root ? (
        <p className="text-sm text-muted-foreground">
          In every chat: each chat starts with the first {formatCount(Memory.injectedLength)} characters of this file.
        </p>
      ) : null}
      <InstructionsField
        label={props.path}
        value={query.data.content}
        placeholder="- One short fact per line"
        empty="This file is empty."
        readOnly={!folder.data?.actions.includes("write")}
        saving={write.isPending}
        onSave={(content) =>
          write.mutateAsync(
            { ...writeScope(props.scope), path: props.path, content },
            { onError: (error) => toast.error("Couldn’t save the file", { description: errorMessage(error) }) },
          )
        }
      />
    </div>
  )
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

export function Pane(props: {
  artifact: ArtifactInfo | undefined
  scope: Scope
  path: string
  tab: FileTabs.Tab
  onFolder: (folder: string) => void
}) {
  if (props.artifact) return <ArtifactPane artifact={props.artifact} />
  if (props.scope.source === "memory") return <MemoryFile scope={props.scope} path={props.path} />
  return <DriveFile scope={props.scope} path={props.path} tab={props.tab} onFolder={props.onFolder} />
}

export function NewMemoryFile(props: {
  scope: Scope
  actions: ReadonlyArray<FileSystem.Action>
  taken: ReadonlyArray<string>
  onCreated: (path: string) => void
}) {
  const { api } = RouterContext.useRouterContext()
  const write = useMutation(api.memory.write.mutationOptions())
  const [open, setOpen] = useState(false)
  const [problem, setProblem] = useState<string>()
  if (props.scope.source !== "memory" || !props.actions.includes("write")) return null
  return (
    <>
      <PageActions>
        <Button onClick={() => setOpen(true)}>
          <IconPlus data-icon="inline-start" />
          New file
        </Button>
      </PageActions>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          setProblem(undefined)
        }}
      >
        <DialogContent>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault()
              const path = formText(new FormData(event.currentTarget), "path").trim()
              if (props.taken.includes(path)) {
                setProblem("A file with this path exists. Open it to edit it.")
                return
              }
              write.mutate(
                { ...writeScope(props.scope), path, content: "" },
                {
                  onSuccess: () => {
                    setOpen(false)
                    props.onCreated(path)
                  },
                  onError: (error) => setProblem(errorMessage(error)),
                },
              )
            }}
          >
            <DialogHeader>
              <DialogTitle>New memory file</DialogTitle>
              <DialogDescription>Agents read and keep these files. Use one file per topic.</DialogDescription>
            </DialogHeader>
            <Field data-invalid={problem !== undefined}>
              <FieldLabel htmlFor="memory-path">Path</FieldLabel>
              <Input
                id="memory-path"
                name="path"
                required
                placeholder="people/ana.md"
                aria-invalid={problem !== undefined}
                onChange={() => setProblem(undefined)}
              />
              {problem ? <FieldError>{problem}</FieldError> : null}
            </Field>
            <DialogFooter className="sm:justify-end">
              <Button type="submit" disabled={write.isPending}>
                {write.isPending ? <Spinner data-icon="inline-start" /> : null}
                Create file
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
