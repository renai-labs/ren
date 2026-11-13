import { FileDiff, InlineCodeKind, PatchFiles } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session/message"

export interface Change {
  readonly path: string
  readonly status: "added" | "deleted" | "modified"
  readonly additions: number
  readonly deletions: number
  readonly views: ReadonlyArray<FileDiff.View>
}

export const workspacePath = InlineCodeKind.relativePath

const editedTools = (messages: ReadonlyArray<SessionMessage.Info>) =>
  messages
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .filter(
      (content): content is SessionMessage.Tool =>
        content.type === "tool" && PatchFiles.isFileChange(content) && content.state.status === "completed",
    )

export const editedPaths = (messages: ReadonlyArray<SessionMessage.Info>) =>
  editedTools(messages).flatMap(PatchFiles.toolPaths).map(workspacePath)

export const editsOf = (messages: ReadonlyArray<SessionMessage.Info>): ReadonlyArray<Change> =>
  PatchFiles.groups(editedTools(messages), { path: workspacePath }).map((group) => ({
    path: group.path,
    status: FileDiff.mergedStatus(group.views),
    additions: group.additions,
    deletions: group.deletions,
    views: group.views,
  }))
