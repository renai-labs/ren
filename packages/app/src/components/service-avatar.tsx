import { Avatar } from "@ren/ui/avatar"
import type { AvatarSize } from "@ren/ui/avatar"
import { Theme } from "@ren/ui/theme"
import { ServiceIcon } from "../lib/service-icon.js"

export function ServiceAvatar(props: { slug: string; size?: AvatarSize }) {
  const theme = Theme.useTheme()
  return (
    <Avatar.Root
      name={props.slug || "?"}
      image={props.slug ? ServiceIcon.url(props.slug, theme.appearance === "light" ? "light" : "dark") : undefined}
      size={props.size ?? "extra-small"}
      shape="square"
      imageFit="contain"
      decorative
    />
  )
}
