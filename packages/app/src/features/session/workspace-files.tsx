import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { ChatReact } from "@ren/chat/react"
import { FileTabs } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session/message"
import type { Session } from "@ren/schema/session"
import { FileBrowser, OpenFile } from "../../components/file-browser.js"
import { DriveFileView } from "../../components/file-preview/drive-file-view.js"
import { useRefreshOn } from "../../lib/use-refresh-on.js"
import { useWorkspaceFiles } from "../../lib/use-workspace-files.js"
import { editedPaths } from "./workspace-edits.js"
import type { PanelRequest } from "./workspace-panel.js"

function ChatFile(props: {
  root: Session.ID
  tab: FileTabs.Tab
  edits: number
  onFolder: (folder: string) => void
  onMention: ((path: string) => void) | undefined
}) {
  const read = ChatReact.useFile({ root: props.root, path: props.tab.path })
  useRefreshOn(props.edits, read.refresh)
  return <OpenFile read={read} tab={props.tab} onFolder={props.onFolder} onMention={props.onMention} />
}

type DriveTarget = { readonly spaceId: string | undefined; readonly file: SessionMessage.DriveFile }

// oxlint-disable-next-line ren/no-comments -- A file the chat showed from the space's drive opens as its own tab beside the environment's files, read from the drive, so it opens while the computer is off too.
const driveTab = "drive:"

export function FilesTab(props: {
  root: Session.ID
  messages: ReadonlyArray<SessionMessage.Info>
  request: PanelRequest | undefined
  onMention: ((path: string) => void) | undefined
  onTerminal: ((folder: string) => void) | undefined
}) {
  const edited = editedPaths(props.messages)
  const tree = useWorkspaceFiles(props.root, edited)
  const navigate = useNavigate()
  const [files, setFiles] = useState(FileTabs.empty)
  const [drives, setDrives] = useState<ReadonlyMap<string, DriveTarget>>(() => new Map())
  const [handled, setHandled] = useState<string>()
  const request = props.request
  if (request?.kind === "files" && request.id !== handled) {
    setHandled(request.id)
    const drive = request.drive
    if (drive) {
      const key = `${driveTab}${drive.file.path}`
      setDrives(new Map([...drives, [key, drive]]))
      setFiles(FileTabs.open(files, key, { pin: true }))
    } else {
      const path = request.path.trim().replace(/^\/+/u, "")
      if (path) tree.reveal(path)
      if (path && !path.endsWith("/")) setFiles(FileTabs.open(files, path, request.line ? { line: request.line } : {}))
    }
  }
  const current = files.tabs.find((tab) => tab.path === files.active)
  const drive = current && drives.get(current.path)
  return (
    <FileBrowser
      tree={tree}
      files={files}
      onFiles={setFiles}
      onMention={props.onMention}
      onTerminal={props.onTerminal}
      empty="Open a file from this chat’s environment to read it here."
    >
      {current && drive ? (
        <DriveFileView
          key={current.path}
          space={drive.spaceId}
          file={drive.file}
          onClose={() => setFiles(FileTabs.close(files, current.path))}
          onFolder={(folder) => void navigate({ to: "/drive", search: { space: drive.spaceId, folder } })}
        />
      ) : current ? (
        <ChatFile
          key={current.path}
          root={props.root}
          tab={current}
          edits={edited.filter((path) => path === current.path).length}
          onFolder={tree.reveal}
          onMention={props.onMention}
        />
      ) : null}
    </FileBrowser>
  )
}
