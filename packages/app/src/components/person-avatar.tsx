import { ResourceAvatar } from "./resource-avatar.js"

const sizes = {
  4: ["size-4", "text-2xs"],
  5: ["size-5", "text-2xs"],
  6: ["size-6", "text-2xs"],
  7: ["size-7", "text-xs"],
  9: ["size-9", "text-sm"],
} as const

export function PersonAvatar(props: {
  name: string
  image?: string | null | undefined
  initials?: string | undefined
  size?: keyof typeof sizes | undefined
  title?: string | undefined
}) {
  const [box, text] = sizes[props.size ?? 5]
  return (
    <ResourceAvatar
      icon={props.image}
      fallback={props.initials ?? props.name.charAt(0).toUpperCase()}
      title={props.title}
      className={box}
      fallbackClassName={text}
    />
  )
}
