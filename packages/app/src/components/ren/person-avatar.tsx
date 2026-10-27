import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

export function PersonAvatar(props: {
  name: string
  image?: string | undefined
  initials?: string | undefined
  className?: string | undefined
}) {
  return (
    <Avatar size="sm" className="data-[size=sm]:size-5">
      {props.image ? <AvatarImage src={props.image} alt="" /> : null}
      <AvatarFallback className={cn("bg-secondary", props.className)}>
        {props.initials ?? props.name.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}
