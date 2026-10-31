import { AttachmentGroup } from "@ren/ui/attachment"
import { InputGroupAddon } from "@ren/ui/input-group"
import { PromptInput } from "@ren/ui/prompt-input"
import type { ReactNode } from "react"

// oxlint-disable-next-line ren/no-comments -- The one composer frame of a new chat and of a running chat: the text sits on top, and the add menu, the apps strip and the controls share the footer.
export function ChatComposer(props: {
  label: string
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
    <PromptInput.Root label={props.label} onSubmit={props.onSubmit}>
      {props.suggestions}
      {props.header}
      {props.queue}
      {props.attachments ? (
        <AttachmentGroup data-testid="attachments-preview">{props.attachments}</AttachmentGroup>
      ) : null}
      <PromptInput.Group>
        {props.status ? (
          <span className="pointer-events-none absolute top-4 left-4 z-10 flex *:pointer-events-auto">
            {props.status}
          </span>
        ) : null}
        {props.children}
        <InputGroupAddon align="block-end" className="px-3 pt-0 pb-3">
          {props.addMenu}
          {props.apps}
          <span className="ml-auto flex min-w-0 items-center gap-2">{props.controls}</span>
        </InputGroupAddon>
      </PromptInput.Group>
    </PromptInput.Root>
  )
}
