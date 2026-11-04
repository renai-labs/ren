import { GitHubMark, LinearMark, SlackMark } from "../icons/brands.js"
import type { Channels } from "../lib/channels.js"

const marks = { github: GitHubMark, slack: SlackMark, linear: LinearMark } as const

export function ChannelMark(props: { provider: Channels.Provider; className?: string | undefined }) {
  const Mark = marks[props.provider]
  return <Mark className={props.className} />
}
