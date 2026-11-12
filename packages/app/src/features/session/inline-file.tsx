import { ChatReact } from "@ren/chat/react"
import { InlineCodeKind } from "@ren/chat/inline-code-kind"
import type { Session } from "@ren/schema/session"
import { AsyncResult } from "effect/reactivity"
import type { ReactNode } from "react"
import { FileChip } from "../../components/file-chip.js"

export function InlineFile(props: { root: Session.ID; text: string; code: ReactNode }) {
  const path = InlineCodeKind.workspacePath(props.text)
  return path ? <ConfirmedFile root={props.root} path={path} text={props.text} code={props.code} /> : props.code
}

function ConfirmedFile(props: { root: Session.ID; path: string; text: string; code: ReactNode }) {
  const found = ChatReact.useFileExists({ root: props.root, path: props.path })
  if (!AsyncResult.isSuccess(found) || found.value === undefined) return props.code
  return <FileChip path={found.value}>{props.text}</FileChip>
}
