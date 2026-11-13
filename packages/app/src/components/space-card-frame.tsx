import type { ReactNode } from "react"
import { Card } from "@ren/ui/card"
import { IconCube, IconLock, IconMessage } from "@tabler/icons-react"

export function SpaceCardFrame(props: {
  title: ReactNode
  description: string
  private?: boolean | undefined
  chats?: ReactNode
  menu?: ReactNode
  members: ReactNode
  apps?: ReactNode
  channels?: ReactNode
  action?: ReactNode
}) {
  const Icon = props.private ? IconLock : IconCube
  return (
    <Card className="relative min-h-56 gap-0 border p-6 shadow-soft ring-0 transition-[background-color,scale] duration-150 ease-out hover:bg-muted/40 active:scale-[0.99] motion-reduce:active:scale-100">
      <div className="flex items-center justify-between gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-5" strokeWidth={1.5} />
        </span>
        <div className="flex items-center gap-2">
          {props.chats ? (
            <div className="flex h-6 shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums [&_svg]:size-3.5">
              <IconMessage />
              {props.chats}
            </div>
          ) : null}
          {props.menu}
        </div>
      </div>
      <div className="mt-5 flex min-w-0 flex-col gap-1">
        {props.title}
        <span className="line-clamp-2 text-sm/5 text-muted-foreground">{props.description || "No description"}</span>
      </div>
      <div className="mt-auto flex min-h-7 items-center gap-4 pt-6 text-xs text-muted-foreground tabular-nums">
        {props.members}
        <div className="ml-auto flex min-w-0 items-center gap-3">
          {props.channels}
          {props.apps}
          {props.action}
        </div>
      </div>
    </Card>
  )
}
