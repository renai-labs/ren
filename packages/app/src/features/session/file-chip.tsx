import { use, type ReactNode } from "react"
import { FileMentions } from "@ren/chat/file-mentions"
import { InlineCodeKind } from "@ren/chat/inline-code-kind"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { FileChip } from "@ren/ui/file-chip"
import { FileIcon } from "@ren/ui/file-icon"
import { FileName } from "@ren/util/file-name"
import { cn } from "cn"
import { AsyncResult } from "effect/reactivity"
import { useCopy } from "../../lib/use-copy.js"
import { useOpenDriveFile } from "./file-outputs.js"
import { OpenPanel } from "./open-panel.js"

export interface ChatDriveFiles {
  readonly spaceId: string | undefined
  readonly files: ReadonlyArray<FileMentions.Known>
}

export function WorkspaceFileChip(props: {
  path: string
  line?: number | undefined
  className?: string | undefined
  children: ReactNode
}) {
  const open = use(OpenPanel)
  const copy = useCopy()
  return (
    <FileChip
      path={props.path}
      className={props.className}
      onOpen={open ? () => open({ kind: "files", path: props.path, line: props.line }) : undefined}
      onCopy={copy ? () => copy(props.path, "Path copied") : undefined}
    >
      {props.children}
    </FileChip>
  )
}

function Named(props: { name: string; mime?: string | undefined; text: string }) {
  return (
    <>
      <FileIcon name={props.name} mime={props.mime} className="mr-1 inline-block size-[1.1em] align-[-0.2em]" />
      {props.text}
    </>
  )
}

function DriveFileChip(props: {
  spaceId: string | undefined
  file: SessionMessage.DriveFile
  className: string
  children: ReactNode
}) {
  const open = useOpenDriveFile(props.spaceId, props.file)
  const copy = useCopy()
  return (
    <>
      <FileChip
        path={props.file.path}
        className={props.className}
        onOpen={open.open}
        onCopy={copy ? () => copy(props.file.path, "Path copied") : undefined}
      >
        {props.children}
      </FileChip>
      {open.dialog}
    </>
  )
}

function ExistingFile(props: { root: Session.ID; path: string; text: string; fallback: ReactNode; className: string }) {
  const found = ChatReact.useFileExists({ root: props.root, path: props.path })
  if (!AsyncResult.isSuccess(found) || found.value === undefined) return props.fallback
  return (
    <WorkspaceFileChip
      path={found.value}
      line={InlineCodeKind.parsePathLineSuffix(props.text).selection?.start}
      className={props.className}
    >
      <Named name={FileName.base(found.value)} text={props.text} />
    </WorkspaceFileChip>
  )
}

export function InlineFile(props: {
  root: Session.ID
  computer: boolean
  drive: ChatDriveFiles | undefined
  text: string
  fallback: ReactNode
  code: boolean
}) {
  const className = cn("whitespace-nowrap", props.code ? "bg-muted px-1 py-0.5 text-[90%]" : "font-sans")
  const drive = props.drive
  const file = drive && FileMentions.find(drive.files, props.text)
  if (drive && file)
    return (
      <DriveFileChip spaceId={drive.spaceId} file={file} className={className}>
        <Named name={file.name} mime={file.mime} text={props.text} />
      </DriveFileChip>
    )
  const path = props.computer && props.code ? InlineCodeKind.workspacePath(props.text) : undefined
  return path ? (
    <ExistingFile root={props.root} path={path} text={props.text} fallback={props.fallback} className={className} />
  ) : (
    props.fallback
  )
}
