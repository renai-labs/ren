import { useState, type SyntheticEvent } from "react"
import { AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { cn } from "cn"
import { DefaultIcon, defaultIcon } from "./default-icon.js"

const sizes = {
  sm: "size-5 rounded-sm",
  md: "size-8 rounded-lg",
  lg: "size-10 rounded-lg",
  xl: "size-11 rounded-xl",
}

const needsTile = (event: SyntheticEvent<HTMLImageElement>) => {
  const image = event.currentTarget
  return image.naturalWidth < 64 || Math.abs(image.naturalWidth / image.naturalHeight - 1) > 0.1
}

const onWhiteTile = "bg-white object-contain p-[14%]"

const isGlyph = (icon: string) => /lucide-static|\/skill-icons\/|@tabler\/icons|\/heroicons@/u.test(icon)

export const appTile = (app: { name: string; description?: string | null; icon?: string | null }) =>
  !app.icon || isGlyph(app.icon) ? defaultIcon("app", app.name, app.description).tile : undefined

export function AppAvatarImage(props: { src: string | undefined }) {
  const [tiled, setTiled] = useState(false)
  if (props.src && isGlyph(props.src)) return null
  return (
    <AvatarImage
      src={props.src}
      alt=""
      onLoad={(event) => setTiled(needsTile(event))}
      className={tiled ? onWhiteTile : "object-cover"}
    />
  )
}

export function AppAvatarFallback(props: { name: string }) {
  const fallback = defaultIcon("app", props.name)
  return (
    <AvatarFallback className={cn("bg-none text-white", fallback.tile)}>
      <fallback.icon className="size-1/2" stroke={1.75} />
    </AvatarFallback>
  )
}

export function AppIcon(props: {
  name: string
  description?: string | null | undefined
  icon?: string | null | undefined
  size?: keyof typeof sizes | undefined
  className?: string | undefined
}) {
  const [failed, setFailed] = useState<string>()
  const [tiled, setTiled] = useState(false)
  const size = sizes[props.size ?? "md"]
  const icon = props.icon && props.icon !== failed ? props.icon : undefined
  if (!icon)
    return (
      <DefaultIcon kind="app" name={props.name} description={props.description} className={cn(size, props.className)} />
    )
  if (isGlyph(icon))
    return (
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center",
          defaultIcon("app", props.name, props.description).tile,
          size,
          props.className,
        )}
      >
        <img
          src={icon}
          alt=""
          draggable={false}
          loading="lazy"
          onError={() => setFailed(icon)}
          className="size-1/2 brightness-0 invert"
        />
      </span>
    )
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden ring-1 ring-black/6 ring-inset dark:ring-white/8",
        size,
        props.className,
      )}
    >
      <img
        src={icon}
        alt=""
        draggable={false}
        loading="lazy"
        onLoad={(event) => setTiled(needsTile(event))}
        onError={() => setFailed(icon)}
        className={cn("size-full", tiled ? onWhiteTile : "object-cover")}
      />
    </span>
  )
}
