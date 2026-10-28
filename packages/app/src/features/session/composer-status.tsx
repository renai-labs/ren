import { Button } from "@ren/ui/button"
import { Rotation } from "../../lib/rotation.js"
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
  if (props.notice._tag === "Starting") return <Starting />
  return (
    <output className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <Spinner className="size-3" />
      <span className="truncate">Reconnecting…</span>
    </output>
  )
}

const phrases = [
  "Starting the sandbox",
  "Pulling up a chair",
  "Laying out the tools",
  "Reading the room",
  "Sharpening pencils",
  "Almost there",
]

function Starting() {
  const index = Rotation.useStep(phrases.length, 2400)
  return (
    <output className="flex min-w-0 items-center text-sm text-muted-foreground">
      <span
        key={index}
        className="shimmer animate-in truncate duration-200 ease-out fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none motion-reduce:shimmer-none"
      >
        {phrases[index]}…
      </span>
    </output>
  )
}
