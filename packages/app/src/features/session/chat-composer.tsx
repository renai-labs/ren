import { AttachmentGroup } from "@ren/ui/attachment"
import { InputGroupAddon } from "@ren/ui/input-group"
import { PromptInput } from "@ren/ui/prompt-input"
import type { ReactNode } from "react"

// oxlint-disable-next-line ren/no-comments -- The one composer frame of a new chat and of a running chat: on one line the add menu and the apps strip lead and the controls trail; stacked, they share the footer.
export function ChatComposer(props: {
  label: string
  layout: PromptInput.Layout
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
  const stacked = props.layout === "stacked"
  return (
    <PromptInput.Root label={props.label} onSubmit={props.onSubmit}>
      {props.suggestions}
      {props.header}
      {props.queue}
      {props.attachments ? (
        <AttachmentGroup data-testid="attachments-preview">{props.attachments}</AttachmentGroup>
      ) : null}
      <PromptInput.Group layout={props.layout}>
        {stacked ? null : (
          <InputGroupAddon className="self-end py-2 pl-1">
            {props.addMenu}
            {props.apps}
            {props.status ? <span className="ml-1 flex min-w-0">{props.status}</span> : null}
          </InputGroupAddon>
        )}
        {stacked && props.status ? (
          <span className="pointer-events-none absolute top-4 left-4 z-10 flex *:pointer-events-auto">
            {props.status}
          </span>
        ) : null}
        {props.children}
        {stacked ? (
          <InputGroupAddon align="block-end" className="px-3 pt-0 pb-3">
            {props.addMenu}
            {props.apps}
            <span className="ml-auto flex min-w-0 items-center gap-2">{props.controls}</span>
          </InputGroupAddon>
        ) : (
          <InputGroupAddon align="inline-end" className="self-end py-2 pr-2">
            {props.controls}
          </InputGroupAddon>
        )}
      </PromptInput.Group>
    </PromptInput.Root>
  )
}
