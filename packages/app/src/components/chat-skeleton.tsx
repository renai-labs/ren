import { Spinner } from "@ren/ui/spinner"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@ren/ui/input-group"
import { IconArrowUp, IconChevronDown, IconCube, IconPlus } from "@tabler/icons-react"

export function ComposerFrame() {
  return (
    <InputGroup className="rounded-2xl bg-card dark:bg-card">
      <InputGroupTextarea aria-label="Message" placeholder="Ask anything, @ to add an app" readOnly />
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

export function ChatSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center px-3 pt-2">
        <span className="flex h-8 items-center gap-1.5 rounded-lg border bg-sidebar px-3 text-sm">
          <IconCube className="size-4" />
          Chat
        </span>
      </header>
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Spinner aria-label="Loading messages" />
      </div>
      <div className="px-6 pb-4">
        <div className="mx-auto max-w-3xl">
          <ComposerFrame />
        </div>
      </div>
    </div>
  )
}
