import { ConversationShell } from "@ren/ui/conversation-shell"
import type { ReactNode } from "react"

// oxlint-disable-next-line ren/no-comments -- The one composer frame of a new chat and of a running chat: the add menu and the apps strip lead the footer, the model picker and send button trail it.
export function ChatComposer(props: {
  label: string
  layout: "stacked" | "adaptive"
  header?: ReactNode
  addMenu?: ReactNode
  apps: ReactNode
  controls: ReactNode
  suggestions?: ReactNode
  queue?: ReactNode
  attachments?: ReactNode
  status?: ReactNode
  onSubmit: () => void
  children: ReactNode
}) {
  return (
    <ConversationShell.Composer
      label={props.label}
      layout={props.layout}
      header={props.header}
      suggestions={props.suggestions}
      queue={props.queue}
      attachments={props.attachments}
      status={props.status}
      onSubmit={props.onSubmit}
      leading={props.addMenu}
      footerLeading={
        <>
          {props.addMenu}
          {props.apps}
        </>
      }
      trailing={props.controls}
      footerTrailing={props.controls}
    >
      {props.children}
    </ConversationShell.Composer>
  )
}
