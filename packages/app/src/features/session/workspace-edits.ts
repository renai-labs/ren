import { PatchFiles } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session/message"

export interface Change {
  readonly path: string
  readonly status: "added" | "deleted" | "modified"
  readonly additions: number
  readonly deletions: number
  readonly patches: ReadonlyArray<{ readonly patch: string; readonly additions: number; readonly deletions: number }>
}

const workspace = /^.*\/workspace\/[^/]+\//u

export const editsOf = (messages: ReadonlyArray<SessionMessage.Info>): ReadonlyArray<Change> => [
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
