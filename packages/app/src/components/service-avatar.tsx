import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Theme } from "@ren/ui/theme"
import { Initials } from "@ren/util/initials"
import { ServiceIcon } from "../lib/service-icon.js"

export function ServiceAvatar(props: { slug: string }) {
  const theme = Theme.useTheme()
  return (
    <Avatar size="sm" aria-hidden className="size-4 rounded-sm after:rounded-sm">
      {props.slug ? (
        <AvatarImage
          src={ServiceIcon.url(props.slug, theme.appearance === "light" ? "light" : "dark")}
          alt=""
          className="m-auto size-3/4 rounded-none object-contain"
        />
      ) : null}
      <AvatarFallback className="rounded-sm text-2xs">{Initials.of(props.slug)}</AvatarFallback>
    </Avatar>
  )
}
