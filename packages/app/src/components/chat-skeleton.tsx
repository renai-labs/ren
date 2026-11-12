import { Loading } from "@ren/ui/loading"
import { Bubble, BubbleContent } from "@ren/ui/bubble"
import { Message, MessageContent } from "@ren/ui/message"
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

export function MessagesSkeleton(props: { label?: string | undefined }) {
  return (
    <Loading label={props.label ?? "Loading messages"}>
      <div className="flex flex-col gap-8">
        <Message align="end">
          <MessageContent>
            <Bubble variant="secondary" align="end">
              <BubbleContent>Help me with this task.</BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
        <Message>
          <MessageContent>
            <Bubble variant="ghost">
              <BubbleContent>
                <p>Here is the information for your task.</p>
                <p>Review the details and choose the next step for your team.</p>
              </BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      </div>
    </Loading>
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
      <div className="mx-auto w-full max-w-3xl flex-1 p-6">
        <MessagesSkeleton />
      </div>
      <div className="px-6 pb-4">
        <div className="mx-auto max-w-3xl">
          <ComposerFrame />
        </div>
      </div>
    </div>
  )
}
