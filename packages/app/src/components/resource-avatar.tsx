import type { ReactNode } from "react"
import { IconCube, IconLock } from "@tabler/icons-react"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { cn } from "cn"
import { IconAgent } from "@ren/ui/heroicons"
import { ResourceIcons } from "../lib/resource-icons.js"

export function ResourceAvatar(props: {
  icon: string | null | undefined
  fallback: ReactNode
  size?: "default" | "sm" | "lg" | undefined
  title?: string | undefined
  className?: string | undefined
  fallbackClassName?: string | undefined
}) {
  const face = ResourceIcons.faceOf(props.icon)
  return (
    <Avatar
      size={props.size ?? "default"}
      title={props.title}
      className={cn("@container after:hidden", props.className)}
    >
      {face?.type === "image" ? <AvatarImage src={face.url} alt="" className="rounded-[inherit]" /> : null}
      {face?.type === "tile" ? (
        <span
          className={cn("flex size-full items-center justify-center rounded-[inherit]", face.className)}
          aria-hidden
        >
          <face.Icon className="size-3/5" />
        </span>
      ) : null}
      {face?.type === "emoji" ? (
        <span className="flex size-full items-center justify-center text-[80cqw] leading-none" aria-hidden>
          {face.emoji}
        </span>
      ) : null}
      {face?.type === "tile" || face?.type === "emoji" ? null : (
        <AvatarFallback className={cn("rounded-[inherit]", props.fallbackClassName)}>{props.fallback}</AvatarFallback>
      )}
    </Avatar>
  )
}

const glyphTile = "bg-muted bg-none text-muted-foreground [&_svg]:size-4"

export function SpaceAvatar(props: {
  space: { readonly kind: string; readonly icon: string | null | undefined }
  inline?: boolean | undefined
  className?: string | undefined
}) {
  const Glyph = props.space.kind === "private" ? IconLock : IconCube
  if (props.inline && !ResourceIcons.faceOf(props.space.icon)) return <Glyph className={props.className} />
  return (
    <ResourceAvatar
      icon={props.space.icon}
      fallback={<Glyph />}
      className={props.className}
      fallbackClassName={glyphTile}
    />
  )
}

export function AgentAvatar(props: { icon: string | null | undefined; className?: string | undefined }) {
  return (
    <ResourceAvatar
      icon={props.icon}
      fallback={<IconAgent />}
      className={props.className}
      fallbackClassName={glyphTile}
    />
  )
}
