import { IconGitBranch, IconHash, IconListCheck } from "@tabler/icons-react"
import { GitHubMark, LinearMark, SlackMark } from "./brand-marks.js"
import type { Channels } from "../lib/channels.js"

const marks = { github: GitHubMark, slack: SlackMark, linear: LinearMark } as const

export function ChannelMark(props: { provider: Channels.Provider; className?: string | undefined }) {
  const Mark = marks[props.provider]
  return <Mark className={props.className} />
}

export const placeIcons = { github: IconGitBranch, slack: IconHash, linear: IconListCheck } as const
