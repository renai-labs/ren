import { type ReactNode, useState } from "react"
import { FileDiff } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionInfo } from "@ren/schema/session/info"
import type { SessionMessage } from "@ren/schema/session/message"
import {
  IconArrowsVertical,
  IconArrowUpRight,
  IconFileDiff,
  IconFold,
  IconGitBranch,
  IconLayoutColumns,
  IconLayoutRows,
  IconRefresh,
  IconTextWrap,
} from "@tabler/icons-react"
import { AsyncResult } from "effect/reactivity"
import { Button } from "@ren/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { FileTree } from "@ren/ui/file-tree"
import type { FileDiffStyle } from "@ren/ui/file-diff"
import { DiffList, type DiffListFile } from "@ren/ui/diff-list"
import { Toggle } from "@ren/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@ren/ui/toggle-group"
import { Theme } from "../../components/theme.js"
import { editsOf, type Change } from "./workspace-edits.js"
import type { PanelRequest } from "./workspace-panel.js"
import { ProjectPicker } from "./project-picker.js"
import type { WorkspaceProject } from "./workspace-project.js"
import { WorkspacePending } from "../../components/workspace-pending.js"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import { Preference } from "../../lib/preference.js"
import { useRefreshOn, useRevalidate } from "../../lib/use-refresh-on.js"
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

interface Display {
  readonly diffStyle: DiffStyle
  readonly wrap: boolean
  readonly tools: ReactNode
}

// oxlint-disable-next-line ren/no-comments -- The order the file tree shows: at each level folders come first, then names with their numbers in order.
const treeOrder = (left: Change, right: Change) => {
  const a = left.path.split("/")
  const b = right.path.split("/")
  const at = a.findIndex((part, index) => part !== b[index])
  if (at === -1) return a.length - b.length
  const folders = Number(at < b.length - 1) - Number(at < a.length - 1)
  return folders || (a[at] ?? "").localeCompare(b[at] ?? "", undefined, { numeric: true, sensitivity: "base" })
}

const filesOf = (changes: ReadonlyArray<Change>): ReadonlyArray<DiffListFile> =>
  changes.toSorted(treeOrder).flatMap((change) =>
    change.views.map((view, index) => ({
      id: index === 0 ? change.path : `${change.path}#${index}`,
      path: change.path,
      key: view.diff.cacheKey,
      additions: view.additions,
      deletions: view.deletions,
      status: change.status,
      source: view.diff.partial
        ? { kind: "patch" as const, patch: view.diff.patch ?? "" }
        : {
            kind: "contents" as const,
            before: view.diff.deletionLines.join(""),
            after: view.diff.additionLines.join(""),
            cacheKey: view.diff.cacheKey,
          },
    })),
  )

function OpenFile(props: { path: string; onOpen: (path: string) => void }) {
  if (props.path.startsWith("/")) return null
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`Open ${props.path}`}
      className="text-muted-foreground"
      onClick={() => props.onOpen(props.path)}
    >
      <IconArrowUpRight />
    </Button>
  )
}

// oxlint-disable-next-line ren/no-comments -- Every changed file in one scrolling list, as t3code shows a diff: headers stay pinned while their file scrolls, each file folds, and the tree jumps to a file.
function Changes(props: {
  changes: ReadonlyArray<Change>
  empty: string
  display: Display
  focus?: Focus | undefined
  onOpenFile: (path: string) => void
}) {
  const theme = Theme.useTheme().preference
  const [chosen, setChosen] = useState(props.focus?.path)
  const [reveal, setReveal] = useState(props.focus ? { id: props.focus.path } : undefined)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [seen, setSeen] = useState(props.focus)
  if (props.focus !== seen) {
    setSeen(props.focus)
    setChosen(props.focus?.path)
    if (props.focus) setReveal({ id: props.focus.path })
  }
  if (props.changes.length === 0) return <NoChanges description={props.empty} />
  const files = filesOf(props.changes)
  const deleted = new Set(props.changes.filter((change) => change.status === "deleted").map((change) => change.path))
  const additions = props.changes.reduce((total, change) => total + change.additions, 0)
  const deletions = props.changes.reduce((total, change) => total + change.deletions, 0)
  const folded = files.every((file) => collapsed.has(file.id))
  return (
    <div className="@container/changes mx-2 mb-4 flex min-h-0 flex-1 overflow-hidden rounded-xl border bg-card">
      <div className="hidden w-52 shrink-0 flex-col border-r @xl/changes:flex">
        <div className="flex h-9 shrink-0 items-center gap-2 px-3 text-xs text-muted-foreground tabular-nums">
          {props.changes.length === 1 ? "1 file" : `${props.changes.length} files`}
          <span className="text-chart-2">+{additions}</span>
          <span className="text-chart-4">−{deletions}</span>
        </div>
        <div className="min-h-0 flex-1">
          <FileTree
            files={props.changes}
            selected={chosen}
            onSelect={(path) => {
              setChosen(path)
              setCollapsed(new Set([...collapsed].filter((id) => id !== path)))
              setReveal({ id: path })
            }}
          />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2 text-xs text-muted-foreground tabular-nums">
          <span className="@xl/changes:hidden">
            {props.changes.length === 1 ? "1 file" : `${props.changes.length} files`}
          </span>
          <div className="ml-auto flex items-center gap-1">{props.display.tools}</div>
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => setCollapsed(folded ? new Set() : new Set(files.map((file) => file.id)))}
          >
            {folded ? <IconArrowsVertical data-icon="inline-start" /> : <IconFold data-icon="inline-start" />}
            {folded ? "Expand all" : "Collapse all"}
          </Button>
        </div>
        <DiffList
          files={files}
          collapsed={collapsed}
          onToggle={(id) =>
            setCollapsed(
              collapsed.has(id) ? new Set([...collapsed].filter((each) => each !== id)) : new Set([...collapsed, id]),
            )
          }
          diffStyle={props.display.diffStyle}
          wrap={props.display.wrap}
          theme={theme}
          reveal={reveal}
          action={(path) => (deleted.has(path) ? null : <OpenFile path={path} onOpen={props.onOpenFile} />)}
          className="min-h-0 flex-1 overflow-auto overscroll-contain"
        />
      </div>
    </div>
  )
}

function Bar(props: { children?: ReactNode; actions: ReactNode }) {
  return (
    <div className="@container/bar flex h-10 shrink-0 items-center gap-2 px-3 not-has-[>div>*]:hidden">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">{props.children}</div>
      <div className="flex shrink-0 items-center gap-1">{props.actions}</div>
    </div>
  )
}

function RepositoryChanges(props: {
  root: Session.ID
  version: number
  project: string
  picker: ReactNode
  display: Display
  onOpenFile: (path: string) => void
  onRefresh: () => void
}) {
  const diff = ChatReact.useVcsDiff({ root: props.root, mode: "working", path: props.project })
  useRefreshOn(props.version, diff.refresh)
  useRevalidate(diff)
  return (
    <>
      <Bar
        actions={
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
        }
      >
        {props.picker}
      </Bar>
      {AsyncResult.isSuccess(diff.result) ? (
        <Changes
          changes={repositoryOf(diff.result.value)}
          empty="The repository has no changes since its last commit."
          display={props.display}
          onOpenFile={props.onOpenFile}
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
      <ToggleGroupItem value="unified" aria-label="Stacked diff" className="text-muted-foreground">
        <IconLayoutRows />
      </ToggleGroupItem>
      <ToggleGroupItem value="split" aria-label="Split diff" className="text-muted-foreground">
        <IconLayoutColumns />
      </ToggleGroupItem>
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
        <span className="hidden min-w-0 items-center gap-1 text-xs text-muted-foreground @md/bar:flex">
          <IconGitBranch className="size-3.5 shrink-0" />
          <span className="truncate font-mono">{props.branch}</span>
        </span>
      ) : null}
    </>
  )
}

// oxlint-disable-next-line ren/no-comments -- Any finished tool call may have changed the files, a shell command included, so each one reads the repository again.
const finishedTools = (messages: ReadonlyArray<SessionMessage.Info>) =>
  messages
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .filter((content) => content.type === "tool" && content.state.status === "completed").length

// oxlint-disable-next-line ren/no-comments -- The server reads an empty path through the brain's own git, which cannot see the hand, so a repository at the top of the chat folder is asked for as "." to reach git on the hand like every other project.
const vcsPath = (projects: WorkspaceProject.Projects) =>
  projects.current === "" && projects.list.some((each) => each.path === "") ? "." : projects.current

function useDisplay() {
  const platform = Platform.usePlatform()
  const [diffStyle, setDiffStyle] = useState(() => ChatPreferences.diffStyle.read(platform.storage))
  const wrap = Preference.usePreference(ChatPreferences.diffWrap)
  return {
    diffStyle,
    wrap,
    tools: (
      <>
        <Toggle
          size="sm"
          aria-label="Wrap long lines"
          pressed={wrap}
          onPressedChange={(next) => ChatPreferences.diffWrap.write(platform.storage, next)}
          className="text-muted-foreground"
        >
          <IconTextWrap />
        </Toggle>
        <DiffStyleToggle
          value={diffStyle}
          onChange={(next) => {
            ChatPreferences.diffStyle.write(platform.storage, next)
            setDiffStyle(next)
          }}
        />
      </>
    ),
  }
}

export function ChangesTab(props: {
  root: Session.ID
  messages: ReadonlyArray<SessionMessage.Info>
  request: PanelRequest | undefined
  projects: WorkspaceProject.Projects
  onOpenFile: (path: string) => void
}) {
  const focus = props.request?.kind === "changes" ? props.request : undefined
  const project = vcsPath(props.projects)
  const vcs = ChatReact.useVcs({ root: props.root, path: project })
  const version = finishedTools(props.messages)
  useRefreshOn(version, () => {
    vcs.refresh()
    props.projects.refresh()
  })
  const projectPicker = <ProjectPicker projects={props.projects} />
  const repository = AsyncResult.isSuccess(vcs.result) && vcs.result.value.provider ? vcs.result.value : undefined
  const [chosen, setChosen] = useState<Source | undefined>(focus ? "edits" : undefined)
  const [seen, setSeen] = useState(focus)
  if (focus !== seen) {
    setSeen(focus)
    if (focus) setChosen("edits")
  }
  const display = useDisplay()
  const edits = (
    <Changes
      changes={editsOf(props.messages)}
      empty="Files Ren creates or edits in this chat show up here as diffs."
      display={display}
      focus={focus}
      onOpenFile={props.onOpenFile}
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
        <Bar actions={null}>{projectPicker}</Bar>
        {edits}
      </div>
    )
  const source = chosen ?? "repository"
  const picker = (
    <>
      {projectPicker}
      <SourcePicker source={source} branch={repository.branch.current} onChange={setChosen} />
    </>
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {source === "repository" ? (
        <RepositoryChanges
          root={props.root}
          version={version}
          project={project}
          picker={picker}
          display={display}
          onOpenFile={props.onOpenFile}
          onRefresh={vcs.refresh}
        />
      ) : (
        <>
          <Bar actions={null}>{picker}</Bar>
          {edits}
        </>
      )}
    </div>
  )
}
