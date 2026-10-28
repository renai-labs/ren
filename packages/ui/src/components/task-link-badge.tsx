import { composeClasses } from "../lib/compose-classes.js"
import { Badge } from "./badge.js"
import { Icon } from "./icon.js"
import type { Glyph } from "./icon.js"
import { Link } from "./link.js"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js"

export type TaskLink = { kind: "github_pr" | "github_issue" | "linear_issue" | "slack_thread" | "url"; url: string }

const glyphs: Record<TaskLink["kind"], Glyph> = {
  github_pr: "Github",
  github_issue: "Github",
  linear_issue: "Linear",
  slack_thread: "Slack",
  url: "Link",
}

export function TaskLinkBadge(props: { link: TaskLink; size?: "small" | "control" }) {
  const url = URL.parse(props.link.url)
  const href = url && (url.protocol === "https:" || url.protocol === "http:") ? url.href : undefined
  const path = url?.pathname.split("/").filter(Boolean) ?? []
  const label = {
    github_pr: `${path[0]}/${path[1]}#${path[3]}`,
    github_issue: `${path[0]}/${path[1]}#${path[3]}`,
    linear_issue: path[2] ?? props.link.url,
    slack_thread: "Slack thread",
    url: url?.hostname.replace(/^www\./u, "") || props.link.url,
  }[props.link.kind]
  const description = {
    github_pr: `GitHub pull request ${label}`,
    github_issue: `GitHub issue ${label}`,
    linear_issue: `Linear issue ${label}`,
    slack_thread: label,
    url: props.link.url,
  }[props.link.kind]
  const badge = (
    <Badge
      variant="outline"
      className={composeClasses("max-w-full gap-2 rounded-full bg-muted", props.size === "small" ? "h-5" : "h-7 px-3")}
    >
      <Icon glyph={glyphs[props.link.kind]} />
      <span className="truncate">{label}</span>
    </Badge>
  )
  const trigger = href ? (
    <Link appearance="quiet" href={href} external aria-label={`${description} (opens in a new tab)`}>
      {badge}
    </Link>
  ) : (
    <span
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need the tooltip to read the full URL
      tabIndex={0}
      className="flex min-w-0 rounded-full focus-visible:outline-2 focus-visible:outline-accent-primary"
    >
      {badge}
    </span>
  )
  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipContent>{props.link.url}</TooltipContent>
    </Tooltip>
  )
}
