import type { Composer } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session/message"
import { IconClock, IconSend, IconX } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"

export function QueuedMessages(props: {
  items: ReadonlyArray<Composer.Queued>
  onRemove: (id: SessionMessage.ID) => void
  onSendNow: (id: SessionMessage.ID) => void
}) {
  return (
    <ul aria-label="Queued messages" className="flex flex-col divide-y rounded-xl border bg-card">
      {props.items.map((item) => (
        <li key={item.id} className="flex items-center gap-2 py-1.5 pr-1.5 pl-3 text-sm">
          <IconClock className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{item.text}</span>
          {item.attachments > 0 ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {item.attachments} {item.attachments === 1 ? "file" : "files"}
            </span>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => props.onSendNow(item.id)}>
            <IconSend />
            Send now
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => props.onRemove(item.id)}>
            <IconX />
          </Button>
        </li>
      ))}
    </ul>
  )
}
