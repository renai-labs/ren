import type { MouseEvent, ReactNode } from "react"
import { IconChevronRight, IconMessage } from "@tabler/icons-react"
import { cn } from "cn"
import { Tooltip, TooltipContent, TooltipTrigger } from "#components/tooltip"

const plain = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

export function ChatMention(props: {
  href: string
  title: ReactNode
  childTitle?: string | undefined
  archived?: boolean | undefined
  details?: ReactNode
  onOpen: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={props.href}
            onClick={(event) => {
              if (!plain(event)) return
              event.preventDefault()
              props.onOpen()
            }}
            data-slot="chat-mention"
            className={cn(
              "rounded-xs font-semibold no-underline underline-offset-2 outline-none hover:underline hover:decoration-dotted focus-visible:ring-3 focus-visible:ring-ring/50",
              props.archived ? "text-muted-foreground" : "text-link",
            )}
          >
            <IconMessage aria-hidden className="mr-1 inline size-3.5 align-text-bottom" />
            {props.title}
            {props.childTitle ? (
              <>
                <IconChevronRight aria-hidden className="mx-0.5 inline size-3 align-baseline text-muted-foreground" />
                {props.childTitle}
              </>
            ) : null}
          </a>
        }
      />
      {props.details ? <TooltipContent className="flex-col items-start gap-0.5">{props.details}</TooltipContent> : null}
    </Tooltip>
  )
}

export function ChatMentionRaw(props: { href?: string | undefined; label: ReactNode; note?: string | undefined }) {
  const label = props.href ? (
    <a href={props.href} className="font-mono text-[0.9em] underline underline-offset-2">
      {props.label}
    </a>
  ) : (
    <span className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em]">{props.label}</span>
  )
  if (!props.note) return label
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="break-all" />}>{label}</TooltipTrigger>
      <TooltipContent>{props.note}</TooltipContent>
    </Tooltip>
  )
}
