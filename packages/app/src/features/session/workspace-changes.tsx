import { useState } from "react"
import { PatchFiles } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session/message"
import { IconFileDiff } from "@tabler/icons-react"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { FileTree } from "@ren/ui/file-tree"
import { PatchDiff } from "@ren/ui/patch-diff"
import { Theme } from "../../components/theme.js"

interface Change {
  readonly path: string
  readonly status: "added" | "deleted" | "modified"
  readonly additions: number
  readonly deletions: number
  readonly patches: ReadonlyArray<{ readonly patch: string; readonly additions: number; readonly deletions: number }>
}

const workspace = /^.*\/workspace\/[^/]+\//u

const changesOf = (messages: ReadonlyArray<SessionMessage.Info>): ReadonlyArray<Change> => [
  ...messages
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .flatMap((content) =>
      content.type === "tool" && PatchFiles.isFileChange(content) && content.state.status === "completed"
        ? PatchFiles.toolFiles(content).filter(PatchFiles.changedFileDiff)
        : [],
    )
    .reduce((byPath, file) => {
      const path = file.file.replace(workspace, "")
      const previous = byPath.get(path)
      return byPath.set(path, {
        path,
        status: previous?.status === "added" && file.status !== "deleted" ? "added" : file.status,
        additions: (previous?.additions ?? 0) + file.additions,
        deletions: (previous?.deletions ?? 0) + file.deletions,
        patches: [
          ...(previous?.patches ?? []),
          { patch: file.patch, additions: file.additions, deletions: file.deletions },
        ],
      })
    }, new Map<string, Change>())
    .values(),
]

export function ChangesTab(props: { messages: ReadonlyArray<SessionMessage.Info> }) {
  const theme = Theme.useTheme().preference
  const changes = changesOf(props.messages)
  const [chosen, setChosen] = useState<string>()
  const selected = changes.find((change) => change.path === chosen) ?? changes.at(0)
  if (changes.length === 0)
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia className="text-muted-foreground [&_svg]:size-6">
            <IconFileDiff />
          </EmptyMedia>
          <EmptyTitle>No changes yet</EmptyTitle>
          <EmptyDescription>Files Ren creates or edits in this chat show up here as diffs.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  const additions = changes.reduce((total, change) => total + change.additions, 0)
  const deletions = changes.reduce((total, change) => total + change.deletions, 0)
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-52 shrink-0 flex-col border-r">
        <div className="flex h-9 shrink-0 items-center gap-2 px-3 text-xs text-muted-foreground tabular-nums">
          {changes.length === 1 ? "1 file" : `${changes.length} files`}
          <span className="text-chart-2">+{additions}</span>
          <span className="text-chart-4">−{deletions}</span>
        </div>
        <div className="min-h-0 flex-1">
          <FileTree files={changes} selected={selected?.path} onSelect={setChosen} />
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
