import { use, type ReactNode } from "react"
import { InlineCodeKind } from "@ren/chat/inline-code-kind"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import { FileChip } from "@ren/ui/file-chip"
import { AsyncResult } from "effect/reactivity"
import { useCopy } from "../../lib/use-copy.js"
import { OpenPanel } from "./open-panel.js"

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

function ExistingFile(props: { root: Session.ID; path: string; text: string; code: ReactNode }) {
  const found = ChatReact.useFileExists({ root: props.root, path: props.path })
  if (!AsyncResult.isSuccess(found) || found.value === undefined) return props.code
  return (
    <WorkspaceFileChip
      path={found.value}
      line={InlineCodeKind.parsePathLineSuffix(props.text).selection?.start}
      className="bg-muted px-1 py-0.5 text-[90%]"
    >
      {props.text}
    </WorkspaceFileChip>
  )
}

export function InlineFile(props: { root: Session.ID; text: string; code: ReactNode }) {
  const path = InlineCodeKind.workspacePath(props.text)
  return path ? <ExistingFile root={props.root} path={path} text={props.text} code={props.code} /> : props.code
}
