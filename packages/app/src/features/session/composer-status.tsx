import { Button } from "@ren/ui/button"
import { Spinner } from "@ren/ui/spinner"
import { Text } from "@ren/ui/text"
import type { ChatView } from "./chat-view.js"

export function ComposerStatus(props: { notice: ChatView.Notice; retrying: boolean; onRetry: () => void }) {
  if (props.notice._tag === "Failed")
    return (
      <output className="flex min-w-0 items-center gap-2">
        <Text purpose="caption" tone="danger" truncation="single-line" element="span">
          {props.notice.reason.split("\n")[0]?.trim() || "The sandbox failed to start."}
        </Text>
        <Button variant="link" size="sm" className="h-auto px-0" disabled={props.retrying} onClick={props.onRetry}>
          {props.retrying ? <Spinner aria-hidden data-icon="inline-start" /> : null}
          Retry
        </Button>
      </output>
    )
  return (
    <output className="flex min-w-0 items-center gap-2">
      <Spinner className="size-3 text-muted-foreground" />
      <Text purpose="caption" tone="secondary" truncation="single-line" element="span">
        {props.notice._tag === "Starting" ? "Starting sandbox…" : "Reconnecting…"}
      </Text>
    </output>
  )
}
