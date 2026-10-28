import { IconBrandGithub, IconBrandSlack, IconGitBranch, IconHash, IconListCheck } from "@tabler/icons-react"
import { AppIcon } from "@/components/ren/app-icon"
import type { Channels } from "@/lib/channels"

export function ChannelMark(props: { provider: Channels.Provider; className?: string | undefined }) {
  if (props.provider === "github") return <IconBrandGithub aria-hidden className={props.className} />
  if (props.provider === "slack") return <IconBrandSlack aria-hidden className={props.className} />
  return <AppIcon name="Linear" size="sm" className={props.className} />
}

export const placeIcons = { github: IconGitBranch, slack: IconHash, linear: IconListCheck } as const
