import { useNavigate } from "@tanstack/react-router"
import { ChatReact } from "@ren/chat/react"
import type { SessionMessage } from "@ren/schema/session/message"
import type { Session } from "@ren/schema/session"
import { FileBrowser, OpenFile } from "../../components/file-browser.js"
import { DriveFileView } from "../../components/file-preview/drive-file-view.js"
import { useRefreshOn, useRevalidate } from "../../lib/use-refresh-on.js"
import { useWorkspaceFiles, type Expansion } from "../../lib/use-workspace-files.js"
import { editedPaths } from "./workspace-edits.js"
import type { FileTarget } from "./workspace-panel.js"
import { ProjectPicker } from "./project-picker.js"
import type { WorkspaceProject } from "./workspace-project.js"

function ChatFile(props: {
  root: Session.ID
  tab: FileTarget
  edits: number
  onOpen: (path: string) => void
  onFolder: (folder: string) => void
  onMention: ((path: string) => void) | undefined
}) {
  const read = ChatReact.useFile({ root: props.root, path: props.tab.path })
  useRefreshOn(props.edits, read.refresh)
  useRevalidate(read)
  return (
    <OpenFile
      read={read}
      tab={props.tab}
      browse={{ root: props.root, onOpen: props.onOpen }}
      onFolder={props.onFolder}
      onMention={props.onMention}
    />
  )
}

export function FilesTab(props: {
  root: Session.ID
  messages: ReadonlyArray<SessionMessage.Info>
  file: FileTarget | undefined
  projects: WorkspaceProject.Projects
  expansion: Expansion
  onOpen: (path: string, options: { readonly pin: boolean }) => void
  onChanges: () => void
  onClose: () => void
  onMention: ((path: string) => void) | undefined
  onTerminal: ((folder: string) => void) | undefined
}) {
  const edited = editedPaths(props.messages)
  const projects = props.projects
  const workspace = useWorkspaceFiles(props.root, edited, projects.current, props.expansion)
  useRefreshOn(workspace.topFolders, projects.refresh)
  const tree = {
    ...workspace,
    refresh: () => {
      workspace.refresh()
      projects.refresh()
    },
  }
  const navigate = useNavigate()
  const file = props.file
  const drive = file?.drive
  return (
    <FileBrowser
      tree={tree}
      header={<ProjectPicker projects={projects} />}
      current={file && !drive ? file.path : undefined}
      open={file !== undefined}
      onOpen={props.onOpen}
      onChanges={props.onChanges}
      onMention={props.onMention}
      onTerminal={props.onTerminal}
      empty="Open a file from this chat’s environment to read it here."
    >
      {file && drive ? (
        <DriveFileView
          key={file.path}
          space={drive.spaceId}
          file={drive.file}
          onClose={props.onClose}
          onFolder={(folder) => void navigate({ to: "/drive", search: { space: drive.spaceId, folder } })}
        />
      ) : null}
      {file && !drive ? (
        <ChatFile
          key={file.path}
          root={props.root}
          tab={file}
          edits={edited.filter((path) => path === file.path).length}
          onOpen={(path) => props.onOpen(path, { pin: false })}
          onFolder={(folder) => {
            projects.reveal(folder)
            tree.reveal(folder)
          }}
          onMention={props.onMention}
        />
      ) : null}
    </FileBrowser>
  )
}
