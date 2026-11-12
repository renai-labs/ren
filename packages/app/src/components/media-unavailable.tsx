import { IconPhotoOff } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Spinner } from "@ren/ui/spinner"
import { cn } from "cn"

const frame =
  "flex h-32 w-48 max-w-full flex-col items-center justify-center gap-1 rounded-md border bg-muted/50 p-3 text-center text-xs text-muted-foreground"

export function MediaUnavailable(props: {
  reason: string
  title?: string
  onRetry?: (() => void) | undefined
  className?: string
}) {
  return (
    <output title={props.title} className={cn(frame, props.className)}>
      <IconPhotoOff className="size-5" />
      <span className="font-medium text-foreground">Image unavailable</span>
      <span>{props.reason}</span>
      {props.onRetry ? (
        <Button variant="outline" size="sm" onClick={props.onRetry}>
          Retry
        </Button>
      ) : null}
    </output>
  )
}

export function MediaLoading(props: { className?: string }) {
  return (
    <div className={cn(frame, props.className)}>
      <Spinner />
    </div>
  )
}
