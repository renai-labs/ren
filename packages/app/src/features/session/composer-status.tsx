import { Button } from "@ren/ui/button"
import { Rotation } from "../../lib/rotation.js"
import { Spinner } from "@ren/ui/spinner"
import type { ChatView } from "./chat-view.js"

export function ComposerStatus(props: { notice: ChatView.Notice; retrying: boolean; onRetry: () => void }) {
  if (props.notice._tag === "Failed")
    return (
      <output
        className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground"
        title={props.notice.reason.split("\n")[0]?.trim()}
      >
        <span className="truncate">Couldn’t wake Ren up.</span>
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0 text-sm text-foreground"
          disabled={props.retrying}
          onClick={props.onRetry}
        >
          {props.retrying ? <Spinner aria-hidden data-icon="inline-start" /> : null}
          Retry
        </Button>
      </output>
    )
  if (props.notice._tag === "Starting") return <Starting />
  return (
    <output className="flex min-w-0 items-center text-sm text-muted-foreground">
      <span className="shimmer truncate motion-reduce:shimmer-none">Reconnecting…</span>
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
      <span className="sr-only">Starting the sandbox</span>
      <span
        key={index}
        aria-hidden
        className="shimmer animate-in truncate duration-200 ease-out fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none motion-reduce:shimmer-none"
      >
        {phrases[index]}…
      </span>
    </output>
  )
}
