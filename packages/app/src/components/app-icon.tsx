import { useState } from "react"
import { IconApps } from "@tabler/icons-react"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { cn } from "cn"

const sizes = {
  sm: "size-5 rounded-sm",
  md: "size-8 rounded-lg",
  lg: "size-10 rounded-lg",
  xl: "size-11 rounded-xl",
}

export function AppIcon(props: {
  icon?: string | null | undefined
  size?: keyof typeof sizes | undefined
  className?: string | undefined
}) {
  const size = sizes[props.size ?? "md"]
  const [failed, setFailed] = useState<string>()
  const icon = props.icon && props.icon !== failed ? props.icon : undefined
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border after:mix-blend-darken dark:after:mix-blend-lighten",
        icon ? "bg-white" : "bg-secondary text-muted-foreground",
        size,
        props.className,
      )}
    >
      {icon ? (
        <img src={icon} alt="" draggable={false} onError={() => setFailed(icon)} className="size-full object-contain" />
      ) : (
        <IconApps className="size-3/5" />
      )}
    </span>
  )
}

export function AppAvatar(props: {
  icon?: string | null | undefined
  size?: "sm" | "default" | "lg" | undefined
  title?: string | undefined
  className?: string | undefined
}) {
  return (
    <Avatar size={props.size ?? "default"} title={props.title} className={props.className}>
      {props.icon ? <AvatarImage src={props.icon} alt="" className="bg-white object-contain" /> : null}
      <AvatarFallback className="bg-secondary bg-none text-muted-foreground">
        <IconApps className="size-3/5" />
      </AvatarFallback>
    </Avatar>
  )
}
