import { type ReactNode, useState } from "react"
import { FileDiff, PatchFiles } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionInfo } from "@ren/schema/session/info"
import type { SessionMessage } from "@ren/schema/session/message"
import { IconFileDiff, IconGitBranch, IconRefresh } from "@tabler/icons-react"
import { AsyncResult } from "effect/reactivity"
import { Button } from "@ren/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { FileTree } from "@ren/ui/file-tree"
import { ToggleGroup, ToggleGroupItem } from "@ren/ui/toggle-group"
import { DiffFile } from "./diff-file.js"
import { workspacePath } from "./open-changes.js"
import { WorkspacePending } from "./workspace-state.js"

interface Change {
  readonly path: string
  readonly status: "added" | "deleted" | "modified"
  readonly additions: number
  readonly deletions: number
  readonly views: ReadonlyArray<FileDiff.View>
}

type Source = "repository" | "edits"

export interface Focus {
  readonly path: string
}

const sum = (views: ReadonlyArray<FileDiff.View>, side: "additions" | "deletions") =>
  views.reduce((total, view) => total + view[side], 0)

const editsOf = (messages: ReadonlyArray<SessionMessage.Info>): ReadonlyArray<Change> =>
  [
    ...messages
      .flatMap((message) => (message.type === "assistant" ? message.content : []))
      .flatMap((content) =>
        content.type === "tool" && PatchFiles.isFileChange(content) && content.state.status === "completed"
          ? PatchFiles.toolFiles(content).filter(PatchFiles.changedFileDiff)
          : [],
      )
      .reduce((byPath, file) => {
        const path = workspacePath(file.file)
        return byPath.set(path, [...(byPath.get(path) ?? []), FileDiff.normalize(file)])
      }, new Map<string, ReadonlyArray<FileDiff.View>>())
      .entries(),
  ].map(([path, edits]) => {
    const views = FileDiff.merge(edits)
    return {
      path,
      status: FileDiff.mergedStatus(edits),
      additions: sum(views, "additions"),
      deletions: sum(views, "deletions"),
      views,
    }
  })

const repositoryOf = (files: ReadonlyArray<SessionInfo.FileDiff>): ReadonlyArray<Change> =>
  files.map((file) => ({
    path: file.file,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    views: [FileDiff.normalize(file)],
  }))

function NoChanges(props: { description: string }) {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia className="text-muted-foreground [&_svg]:size-6">
          <IconFileDiff />
        </EmptyMedia>
        <EmptyTitle>No changes yet</EmptyTitle>
        <EmptyDescription>{props.description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function Changes(props: { changes: ReadonlyArray<Change>; empty: string; focus?: Focus | undefined }) {
  const [chosen, setChosen] = useState(props.focus?.path)
  const [seen, setSeen] = useState(props.focus)
  if (props.focus !== seen) {
    setSeen(props.focus)
    setChosen(props.focus?.path)
  }
  const selected = props.changes.find((change) => change.path === chosen) ?? props.changes.at(0)
  if (props.changes.length === 0) return <NoChanges description={props.empty} />
  const additions = props.changes.reduce((total, change) => total + change.additions, 0)
  const deletions = props.changes.reduce((total, change) => total + change.deletions, 0)
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-52 shrink-0 flex-col border-r">
        <div className="flex h-9 shrink-0 items-center gap-2 px-3 text-xs text-muted-foreground tabular-nums">
          {props.changes.length === 1 ? "1 file" : `${props.changes.length} files`}
          <span className="text-chart-2">+{additions}</span>
          <span className="text-chart-4">−{deletions}</span>
        </div>
        <div className="min-h-0 flex-1">
          <FileTree files={props.changes} selected={selected?.path} onSelect={setChosen} />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-1">
        {selected?.views.map((view) => (
          <DiffFile key={view.diff.cacheKey} view={view} />
        ))}
      </div>
    </div>
  )
}

function Bar(props: { children: ReactNode }) {
  return <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">{props.children}</div>
}

function RepositoryChanges(props: {
  root: Session.ID
  picker: ReactNode
  focus: Focus | undefined
  onRefresh: () => void
}) {
  const diff = ChatReact.useVcsDiff(props.root, "working")
  return (
    <>
      <Bar>
        {props.picker}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh changes"
          className="ml-auto text-muted-foreground"
          onClick={() => {
            props.onRefresh()
            diff.refresh()
          }}
        >
          <IconRefresh />
        </Button>
      </Bar>
      {AsyncResult.isSuccess(diff.result) ? (
        <Changes
          changes={repositoryOf(diff.result.value)}
          empty="The repository has no changes since its last commit."
          focus={props.focus}
        />
      ) : (
        <WorkspacePending
          result={diff.result}
          icon={<IconFileDiff />}
          title="Could not read the changes"
          onRetry={diff.refresh}
        />
      )}
    </>
  )
}

export function ChangesTab(props: {
  root: Session.ID
  messages: ReadonlyArray<SessionMessage.Info>
  focus?: Focus | undefined
}) {
  const vcs = ChatReact.useVcs(props.root)
  const repository = AsyncResult.isSuccess(vcs.result) && vcs.result.value.provider ? vcs.result.value : undefined
  const [chosen, setChosen] = useState<Source | undefined>(props.focus ? "edits" : undefined)
  const [seen, setSeen] = useState(props.focus)
  if (props.focus !== seen) {
    setSeen(props.focus)
    if (props.focus) setChosen("edits")
  }
  const edits = (
    <Changes
      changes={editsOf(props.messages)}
      empty="Files Ren creates or edits in this chat show up here as diffs."
      focus={props.focus}
    />
  )
  if (AsyncResult.isInitial(vcs.result))
    return (
      <WorkspacePending
        result={vcs.result}
        icon={<IconFileDiff />}
        title="Could not read the changes"
        onRetry={vcs.refresh}
      />
    )
  if (!repository) return edits
  const source = chosen ?? "repository"
  const picker = (
    <>
      <ToggleGroup
        size="sm"
        value={[source]}
        onValueChange={(value: ReadonlyArray<string>) => {
          const next = value.at(0)
          if (next === "repository" || next === "edits") setChosen(next)
        }}
      >
        <ToggleGroupItem value="repository">Repository</ToggleGroupItem>
        <ToggleGroupItem value="edits">Ren’s edits</ToggleGroupItem>
      </ToggleGroup>
      {repository.branch.current ? (
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <IconGitBranch className="size-3.5 shrink-0" />
          <span className="truncate font-mono">{repository.branch.current}</span>
        </span>
      ) : null}
    </>
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {source === "repository" ? (
        <RepositoryChanges root={props.root} picker={picker} focus={props.focus} onRefresh={vcs.refresh} />
      ) : (
        <>
          <Bar>{picker}</Bar>
          {edits}
        </>
      )}
    </div>
  )
}
