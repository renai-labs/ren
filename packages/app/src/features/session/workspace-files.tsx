import { useState } from "react"
import { ChatReact } from "@ren/chat/react"
import { FileTabs } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session/message"
import type { Session } from "@ren/schema/session"
import { FileBrowser, OpenFile } from "../../components/file-browser.js"
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

export function FilesTab(props: {
  root: Session.ID
  messages: ReadonlyArray<SessionMessage.Info>
  request: PanelRequest | undefined
  onMention: ((path: string) => void) | undefined
  onTerminal: ((folder: string) => void) | undefined
}) {
  const edited = editedPaths(props.messages)
  const tree = useWorkspaceFiles(props.root, edited)
  const [files, setFiles] = useState(FileTabs.empty)
  const [handled, setHandled] = useState<string>()
  if (props.request?.kind === "files" && props.request.id !== handled) {
    const path = props.request.path.trim().replace(/^\/+/u, "")
    setHandled(props.request.id)
    if (path) tree.reveal(path)
    if (path && !path.endsWith("/"))
      setFiles(FileTabs.open(files, path, props.request.line ? { line: props.request.line } : {}))
  }
  const current = files.tabs.find((tab) => tab.path === files.active)
  return (
    <FileBrowser
      tree={tree}
      files={files}
      onFiles={setFiles}
      onMention={props.onMention}
      onTerminal={props.onTerminal}
      empty="Open a file from this chat’s environment to read it here."
    >
      {current ? (
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
