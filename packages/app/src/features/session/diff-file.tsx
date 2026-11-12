import type { ReactNode } from "react"
import type { FileDiff } from "@ren/chat"
import { FileDiffView } from "@ren/ui/file-diff"
import { Theme } from "../../components/theme.js"
import { workspacePath } from "./open-changes.js"

export function DiffFile(props: { view: FileDiff.View; capped?: boolean; action?: ReactNode }) {
  const theme = Theme.useTheme().preference
  const diff = props.view.diff
  return (
    <FileDiffView
      path={workspacePath(props.view.file)}
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
      action={props.action}
    />
  )
}
