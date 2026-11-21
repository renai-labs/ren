import type { Composer } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session/message"
import { IconArrowUp, IconX } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { cn } from "cn"

export function QueuedMessages(props: {
  items: ReadonlyArray<Composer.Queued>
  onRemove: (id: SessionMessage.ID) => void
  onSendNow: (id: SessionMessage.ID) => void
}) {
  const count = props.items.length
  if (count === 0) return null
  return (
    <div className="relative -mb-5 rounded-xl border bg-muted/40 px-1.5 pt-1.5 pb-4.5">
      {count > 3 ? (
        <div className="px-2 pt-0.5 pb-1 text-2xs font-medium tracking-wide text-muted-foreground uppercase tabular-nums">
          {count} queued
        </div>
      ) : null}
      <ul
        aria-label="Queued messages"
        className={cn(
          "flex flex-col gap-px",
          count > 4 && "max-h-37 overflow-y-auto overscroll-contain mask-t-from-95% mask-b-from-92%",
        )}
      >
        {props.items.map((item) => (
          <li
            key={item.id}
            className="group/queued flex h-8 shrink-0 items-center gap-2 rounded-md pr-1 pl-2 text-sm hover:bg-muted/60"
          >
            <span dir="auto" className="min-w-0 flex-1 truncate">
              {item.text}
            </span>
            {item.attachments > 0 ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {item.attachments} {item.attachments === 1 ? "file" : "files"}
              </span>
            ) : null}
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 ease-out group-hover/queued:opacity-100 focus-within:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => props.onSendNow(item.id)}
              >
                <IconArrowUp />
                Send now
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label="Remove"
                onClick={() => props.onRemove(item.id)}
              >
                <IconX />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
