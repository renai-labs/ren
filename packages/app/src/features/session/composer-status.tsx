import { Button } from "@ren/ui/button"
import { ProgressIndicator } from "@ren/ui/progress-indicator"
import { Text } from "@ren/ui/text"
import type { ChatView } from "./chat-view.js"

export function ComposerStatus(props: { notice: ChatView.Notice; retrying: boolean; onRetry: () => void }) {
  if (props.notice._tag === "Failed")
    return (
      <output className="flex min-w-0 items-center gap-2">
        <Text purpose="caption" tone="danger" truncation="single-line" element="span">
          {props.notice.reason.split("\n")[0]?.trim() || "The sandbox failed to start."}
        </Text>
        <Button appearance="link" size="small" pending={props.retrying} onClick={props.onRetry}>
          Retry
        </Button>
      </output>
    )
  return (
    <output className="flex min-w-0 items-center gap-2">
      <ProgressIndicator size="extra-small" />
      <Text purpose="caption" tone="secondary" truncation="single-line" element="span">
        {props.notice._tag === "Starting" ? "Starting sandbox…" : "Reconnecting…"}
      </Text>
    </output>
  )
}
