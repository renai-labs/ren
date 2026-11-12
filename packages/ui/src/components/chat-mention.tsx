import type { MouseEvent, ReactNode } from "react"
import { IconChevronRight, IconMessage } from "@tabler/icons-react"
import { cn } from "cn"
import { Tooltip, TooltipContent, TooltipTrigger } from "#components/tooltip"

const plain = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

export function ChatMention(props: {
  href: string
  title: string
  childTitle?: string | undefined
  archived?: boolean | undefined
  current?: boolean | undefined
  details: ReactNode
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
              if (!props.current) props.onOpen()
            }}
            data-slot="chat-mention"
            className={cn(
              "inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-px align-bottom text-sm/5 font-medium no-underline transition-colors hover:bg-accent",
              props.archived ? "bg-muted/50 text-muted-foreground" : "bg-muted text-foreground",
            )}
          >
            <IconMessage aria-hidden className={cn("size-3.5 shrink-0", props.archived && "text-muted-foreground")} />
            <span className="truncate">{props.title}</span>
            {props.childTitle ? (
              <>
                <IconChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{props.childTitle}</span>
              </>
            ) : null}
          </a>
        }
      />
      <TooltipContent className="flex-col items-start gap-0.5">{props.details}</TooltipContent>
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
