import { Spinner } from "@ren/ui/spinner"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@ren/ui/input-group"
import { IconArrowUp, IconChevronDown, IconCube, IconPlus } from "@tabler/icons-react"
import { Breadcrumb } from "./breadcrumb.js"
import { DarkUi } from "../lib/dark-ui.js"

function DeepComposerFrame() {
  return (
    <div data-slot="composer" data-placement="chat" data-blank="true" className="relative flex flex-col gap-2">
      <InputGroup data-shell="false" className="rounded-xl bg-card shadow-soft dark:bg-card">
        <InputGroupTextarea
          aria-label="Message"
          placeholder="Ask anything, @ to mention"
          readOnly
          rows={1}
          className="max-h-60 min-h-16 px-4 pt-4 leading-relaxed"
        />
        <InputGroupAddon align="block-end" data-composer-part="toolbar" className="px-3 pt-0 pb-3">
          <InputGroupButton
            data-composer-part="add"
            variant="secondary"
            size="icon-sm"
            className="rounded-full"
            aria-label="Add to this chat"
            disabled
          >
            <IconPlus />
          </InputGroupButton>
          <InputGroupButton data-composer-part="model" size="sm" className="ml-auto font-normal" disabled>
            Choose model
            <IconChevronDown />
          </InputGroupButton>
          <InputGroupButton
            data-composer-part="send"
            data-filled={false}
            variant="secondary"
            size="icon-sm"
            className="rounded-full"
            aria-label="Send"
            disabled
          >
            <IconArrowUp />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

export function ComposerFrame() {
  const deep = DarkUi.useDarkUi()
  if (deep) return <DeepComposerFrame />
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
  const deep = DarkUi.useDarkUi()
  if (deep)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header data-slot="page-bar" className="flex shrink-0 items-center gap-1">
          <span data-slot="chat-skeleton-crumb" className="flex items-center gap-1.5">
            <IconCube className="size-4" />
            Chat
          </span>
        </header>
        <MessagesSpinner />
        <div data-slot="chat-dock" className="px-6 pb-4">
          <div data-slot="chat-column" className="mx-auto w-full">
            <DeepComposerFrame />
          </div>
        </div>
      </div>
    )
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
