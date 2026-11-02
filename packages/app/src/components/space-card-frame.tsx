import type { ReactNode } from "react"
import { Card } from "@ren/ui/card"
import { IconCube, IconLock, IconMessage } from "@tabler/icons-react"

export function SpaceCardFrame(props: {
  title: ReactNode
  description: string
  private?: boolean | undefined
  chats: ReactNode
  menu: ReactNode
  members: ReactNode
  apps: ReactNode
}) {
  const Icon = props.private ? IconLock : IconCube
  return (
    <Card className="relative gap-6 border p-5 shadow-soft ring-0 transition-[background-color,scale] duration-150 ease-out hover:bg-muted/40 active:scale-[0.99] motion-reduce:active:scale-100">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-6 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {props.title}
          <span className="line-clamp-2 text-sm text-muted-foreground">{props.description || "No description"}</span>
        </div>
        <div className="flex h-6 shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums [&_svg]:size-3.5">
          <IconMessage />
          {props.chats}
        </div>
        {props.menu}
      </div>
      <div className="flex min-h-6 items-center gap-4 text-xs text-muted-foreground tabular-nums">
        {props.members}
        <div className="ml-auto">{props.apps}</div>
      </div>
    </Card>
  )
}
