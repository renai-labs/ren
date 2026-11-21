import type { ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { cn } from "cn"

export function TruncatedText(props: { text: string; children?: ReactNode; className?: string | undefined }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className={cn(
              "block min-w-0 truncate rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              props.className,
            )}
          />
        }
      >
        {props.children ?? props.text}
      </TooltipTrigger>
      <TooltipContent>{props.text}</TooltipContent>
    </Tooltip>
  )
}
