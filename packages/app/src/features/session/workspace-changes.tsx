import { type ReactNode, useState } from "react"
import { FileDiff } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionInfo } from "@ren/schema/session/info"
import type { SessionMessage } from "@ren/schema/session/message"
import { IconFileDiff, IconGitBranch, IconRefresh } from "@tabler/icons-react"
import { AsyncResult } from "effect/reactivity"
import { Button } from "@ren/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { FileTree } from "@ren/ui/file-tree"
import type { FileDiffStyle } from "@ren/ui/file-diff"
import { ToggleGroup, ToggleGroupItem } from "@ren/ui/toggle-group"
import { DiffFile } from "./diff-file.js"
import { editsOf, type Change } from "./workspace-edits.js"
import type { PanelRequest } from "./workspace-panel.js"
import { WorkspacePending } from "./workspace-state.js"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import { Platform } from "../../platform/platform.js"

type Source = "repository" | "edits"

type Focus = Extract<PanelRequest, { kind: "changes" }>

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

type DiffStyle = FileDiffStyle

function Changes(props: {
  changes: ReadonlyArray<Change>
  empty: string
  diffStyle: DiffStyle
  focus?: Focus | undefined
}) {
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
          <DiffFile key={view.diff.cacheKey} view={view} diffStyle={props.diffStyle} />
        ))}
      </div>
    </div>
  )
}

function Bar(props: { children?: ReactNode; actions: ReactNode }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
      {props.children}
      <div className="ml-auto flex items-center gap-1">{props.actions}</div>
    </div>
  )
}

function RepositoryChanges(props: {
  root: Session.ID
  picker: ReactNode
  diffToggle: ReactNode
  diffStyle: DiffStyle
  onRefresh: () => void
}) {
  const diff = ChatReact.useVcsDiff(props.root, "working")
  return (
    <>
      <Bar
        actions={
          <>
            {props.diffToggle}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh changes"
              className="text-muted-foreground"
              onClick={() => {
                props.onRefresh()
                diff.refresh()
              }}
            >
              <IconRefresh />
            </Button>
          </>
        }
      >
        {props.picker}
      </Bar>
      {AsyncResult.isSuccess(diff.result) ? (
        <Changes
          changes={repositoryOf(diff.result.value)}
          empty="The repository has no changes since its last commit."
          diffStyle={props.diffStyle}
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

function DiffStyleToggle(props: { value: DiffStyle; onChange: (next: DiffStyle) => void }) {
  return (
    <ToggleGroup
      size="sm"
      aria-label="Diff style"
      value={[props.value]}
      onValueChange={(value: ReadonlyArray<string>) => {
        const next = value.at(0)
        if (next === "unified" || next === "split") props.onChange(next)
      }}
    >
      <ToggleGroupItem value="unified">Stacked</ToggleGroupItem>
      <ToggleGroupItem value="split">Split</ToggleGroupItem>
    </ToggleGroup>
  )
}

function SourcePicker(props: { source: Source; branch: string | undefined; onChange: (next: Source) => void }) {
  return (
    <>
      <ToggleGroup
        size="sm"
        value={[props.source]}
        onValueChange={(value: ReadonlyArray<string>) => {
          const next = value.at(0)
          if (next === "repository" || next === "edits") props.onChange(next)
        }}
      >
        <ToggleGroupItem value="repository">Repository</ToggleGroupItem>
        <ToggleGroupItem value="edits">Ren’s edits</ToggleGroupItem>
      </ToggleGroup>
      {props.branch ? (
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <IconGitBranch className="size-3.5 shrink-0" />
          <span className="truncate font-mono">{props.branch}</span>
        </span>
      ) : null}
    </>
  )
}

export function ChangesTab(props: {
  root: Session.ID
  messages: ReadonlyArray<SessionMessage.Info>
  request: PanelRequest | undefined
}) {
  const focus = props.request?.kind === "changes" ? props.request : undefined
  const platform = Platform.usePlatform()
  const vcs = ChatReact.useVcs(props.root)
  const repository = AsyncResult.isSuccess(vcs.result) && vcs.result.value.provider ? vcs.result.value : undefined
  const [chosen, setChosen] = useState<Source | undefined>(focus ? "edits" : undefined)
  const [seen, setSeen] = useState(focus)
  if (focus !== seen) {
    setSeen(focus)
    if (focus) setChosen("edits")
  }
  const [diffStyle, setDiffStyle] = useState(() => ChatPreferences.diffStyle.read(platform.storage))
  const diffToggle = (
    <DiffStyleToggle
      value={diffStyle}
      onChange={(next) => {
        ChatPreferences.diffStyle.write(platform.storage, next)
        setDiffStyle(next)
      }}
    />
  )
  const edits = (
    <Changes
      changes={editsOf(props.messages)}
      empty="Files Ren creates or edits in this chat show up here as diffs."
      diffStyle={diffStyle}
      focus={focus}
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
  if (!repository)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Bar actions={diffToggle} />
        {edits}
      </div>
    )
  const source = chosen ?? "repository"
  const picker = <SourcePicker source={source} branch={repository.branch.current} onChange={setChosen} />
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {source === "repository" ? (
        <RepositoryChanges
          root={props.root}
          picker={picker}
          diffToggle={diffToggle}
          diffStyle={diffStyle}
          onRefresh={vcs.refresh}
        />
      ) : (
        <>
          <Bar actions={diffToggle}>{picker}</Bar>
          {edits}
        </>
      )}
    </div>
  )
}
