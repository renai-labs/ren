import { type ReactNode, useState } from "react"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionInfo } from "@ren/schema/session/info"
import type { SessionMessage } from "@ren/schema/session/message"
import { IconFileDiff, IconGitBranch, IconRefresh } from "@tabler/icons-react"
import { AsyncResult } from "effect/reactivity"
import { Button } from "@ren/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { FileTree } from "@ren/ui/file-tree"
import { PatchDiff } from "@ren/ui/patch-diff"
import { ToggleGroup, ToggleGroupItem } from "@ren/ui/toggle-group"
import { Theme } from "../../components/theme.js"
import type { Change } from "./workspace-edits.js"
import { editsOf } from "./workspace-edits.js"
import { WorkspacePending } from "./workspace-state.js"

type Source = "repository" | "edits"

const repositoryOf = (files: ReadonlyArray<SessionInfo.FileDiff>): ReadonlyArray<Change> =>
  files.map((file) => ({
    path: file.file,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    patches: [{ patch: file.patch, additions: file.additions, deletions: file.deletions }],
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

function Changes(props: { changes: ReadonlyArray<Change>; empty: string }) {
  const theme = Theme.useTheme().preference
  const [chosen, setChosen] = useState<string>()
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
        {selected?.patches.map((each, index) => (
          <PatchDiff key={each.patch} patch={each.patch} theme={theme}>
            <span className="flex items-center gap-2 py-2 text-xs text-muted-foreground tabular-nums">
              {selected.patches.length > 1 ? `Change ${index + 1}` : selected.path}
              <span className="text-chart-2">+{each.additions}</span>
              <span className="text-chart-4">−{each.deletions}</span>
            </span>
          </PatchDiff>
        ))}
      </div>
    </div>
  )
}

function Bar(props: { children: ReactNode }) {
  return <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">{props.children}</div>
}

function RepositoryChanges(props: { root: Session.ID; picker: ReactNode; onRefresh: () => void }) {
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

export function ChangesTab(props: { root: Session.ID; messages: ReadonlyArray<SessionMessage.Info> }) {
  const vcs = ChatReact.useVcs(props.root)
  const repository = AsyncResult.isSuccess(vcs.result) && vcs.result.value.provider ? vcs.result.value : undefined
  const [chosen, setChosen] = useState<Source>()
  const edits = (
    <Changes changes={editsOf(props.messages)} empty="Files Ren creates or edits in this chat show up here as diffs." />
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
        <RepositoryChanges root={props.root} picker={picker} onRefresh={vcs.refresh} />
      ) : (
        <>
          <Bar>{picker}</Bar>
          {edits}
        </>
      )}
    </div>
  )
}
