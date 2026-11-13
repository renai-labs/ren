import type { ReactNode } from "react"
import type { FileDiff } from "@ren/chat"
import { FileDiffView, type FileDiffStyle } from "@ren/ui/file-diff"
import { Theme } from "../../components/theme.js"
import { WorkspaceFileChip } from "./file-chip.js"
import { workspacePath } from "./workspace-edits.js"

export function DiffFile(props: {
  view: FileDiff.View
  capped?: boolean
  diffStyle?: FileDiffStyle
  action?: ReactNode
}) {
  const theme = Theme.useTheme().preference
  const diff = props.view.diff
  const path = workspacePath(props.view.file)
  return (
    <FileDiffView
      path={path}
      status={props.view.status}
      additions={props.view.additions}
      deletions={props.view.deletions}
      source={
        diff.partial
          ? { kind: "patch", patch: diff.patch ?? "" }
          : {
              kind: "contents",
              before: diff.deletionLines.join(""),
              after: diff.additionLines.join(""),
              cacheKey: diff.cacheKey,
            }
      }
      lines={diff.hunks.flatMap((hunk) => hunk.lines)}
      theme={theme}
      capped={props.capped}
      diffStyle={props.diffStyle}
      title={
        path.startsWith("/") || props.view.status === "deleted" ? undefined : (
          <WorkspaceFileChip path={path}>{path.split("/").at(-1)}</WorkspaceFileChip>
        )
      }
      action={props.action}
    />
  )
}
