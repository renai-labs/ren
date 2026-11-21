import type { ComponentType, ReactNode } from "react"
import { IconChevronDown } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { CollapsibleTrigger } from "@ren/ui/collapsible"

export function GroupHeader(props: {
  label: string
  icon: ComponentType<{ className?: string }>
  count: number
  title?: ReactNode | undefined
  action?: ReactNode | undefined
}) {
  return (
    <div className="sticky top-0 z-20 bg-background">
      <div className="flex h-9 items-center gap-2 rounded-lg bg-muted pr-2 pl-1 text-sm">
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground aria-expanded:hover:bg-muted aria-expanded:hover:text-foreground [&_svg]:-rotate-90 aria-expanded:[&_svg]:rotate-0"
              aria-label={`Toggle ${props.label}`}
            />
          }
        >
          <IconChevronDown className="size-3.5" />
        </CollapsibleTrigger>
        <props.icon className="size-4 text-muted-foreground" />
        <h2 className="min-w-0 truncate font-medium">{props.title ?? props.label}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{props.count}</span>
        {props.action ? <span className="ml-auto flex">{props.action}</span> : null}
      </div>
    </div>
  )
}
