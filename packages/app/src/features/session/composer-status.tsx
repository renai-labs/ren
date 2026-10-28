import { Button } from "@ren/ui/button"
import { Spinner } from "@ren/ui/spinner"
import type { ChatView } from "./chat-view.js"

export function ComposerStatus(props: { notice: ChatView.Notice; retrying: boolean; onRetry: () => void }) {
  if (props.notice._tag === "Failed")
    return (
      <output className="flex min-w-0 items-center gap-2 text-xs">
        <span className="truncate text-destructive">
          {props.notice.reason.split("\n")[0]?.trim() || "The sandbox failed to start."}
        </span>
        <Button variant="link" size="xs" className="h-auto px-0" disabled={props.retrying} onClick={props.onRetry}>
          {props.retrying ? <Spinner aria-hidden data-icon="inline-start" /> : null}
          Retry
        </Button>
      </output>
    )
  return (
    <output className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <Spinner className="size-3" />
      <span className="truncate">{props.notice._tag === "Starting" ? "Starting sandbox…" : "Reconnecting…"}</span>
    </output>
  )
}
