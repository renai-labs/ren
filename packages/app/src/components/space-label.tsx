import { useSpaces } from "../lib/use-spaces.js"
import { SpaceAvatar } from "./resource-avatar.js"

export function SpaceLabel(props: { spaceId: string }) {
  const spaces = useSpaces()
  return (
    <span className="flex min-w-0 items-center gap-2">
      <SpaceAvatar
        space={spaces.space(props.spaceId) ?? { kind: "shared", icon: null }}
        inline
        className="size-4 shrink-0 rounded-sm"
      />
      <span className="truncate">{spaces.spaceName(props.spaceId)}</span>
    </span>
  )
}
