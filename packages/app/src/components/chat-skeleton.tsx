import { Spinner } from "@ren/ui/spinner"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@ren/ui/input-group"
import { IconArrowUp, IconChevronDown, IconCube, IconPlus } from "@tabler/icons-react"
import { Breadcrumb } from "./breadcrumb.js"

export function ComposerFrame() {
  return (
    <InputGroup className="rounded-2xl bg-card dark:bg-card">
      <InputGroupTextarea aria-label="Message" placeholder="Ask anything, @ to mention" readOnly />
      <InputGroupAddon align="block-end">
        <InputGroupButton size="icon-sm" aria-label="Add to this chat" disabled>
          <IconPlus />
        </InputGroupButton>
        <InputGroupButton className="ml-auto" disabled>
          Choose model
          <IconChevronDown />
        </InputGroupButton>
        <InputGroupButton size="icon-sm" aria-label="Send" disabled>
          <IconArrowUp />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

export function MessagesSpinner() {
  return (
    <div className="flex min-h-0 flex-1 animate-in items-center justify-center delay-300 duration-200 fade-in-0 fill-mode-backwards motion-reduce:animate-none">
      <Spinner aria-label="Loading messages" className="size-5 text-muted-foreground" />
    </div>
  )
}

export function ChatSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Breadcrumb.Header>
        <span className="flex h-8 items-center gap-1.5 rounded-lg border bg-sidebar px-3 text-sm">
          <IconCube className="size-4" />
          Chat
        </span>
      </Breadcrumb.Header>
      <MessagesSpinner />
      <div className="px-6 pb-4">
        <div className="mx-auto max-w-(--container-chat)">
          <ComposerFrame />
        </div>
      </div>
    </div>
  )
}
