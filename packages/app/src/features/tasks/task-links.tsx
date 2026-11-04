import type { TaskInfo } from "@ren/client"
import type { ComponentType } from "react"
import { IconWorld } from "@tabler/icons-react"
import { GitHubMark, LinearMark, SlackMark } from "../../components/brand-marks.js"
import { Badge } from "@ren/ui/badge"
import { Link } from "@ren/ui/link"

type TaskLink = TaskInfo["links"][number]

const githubLabel = (url: URL) => {
  const parts = url.pathname.split("/").filter(Boolean)
  return parts.length >= 4 ? `${parts[0]}/${parts[1]}#${parts[3]}` : url.pathname.slice(1)
}

const linearLabel = (url: URL) =>
  url.pathname.split("/").find((part) => /^[A-Z][A-Z0-9]*-\d+$/u.test(part)) ?? "Linear issue"

type Mark = ComponentType<{ className?: string }>

function describe(link: TaskLink): { mark: Mark; label: string } {
  const url = URL.parse(link.url)
  if (!url) return { mark: IconWorld, label: link.url }
  if (link.kind === "github_pr" || link.kind === "github_issue") return { mark: GitHubMark, label: githubLabel(url) }
  if (link.kind === "linear_issue") return { mark: LinearMark, label: linearLabel(url) }
  if (link.kind === "slack_thread") return { mark: SlackMark, label: "Slack thread" }
  return { mark: IconWorld, label: url.hostname.replace(/^www\./u, "") + (url.pathname === "/" ? "" : url.pathname) }
}

function LinkMark(props: { shown: ReturnType<typeof describe> }) {
  return (
    <span className="flex shrink-0">
      <props.shown.mark className="size-3.5 text-foreground" />
    </span>
  )
}

const shortLabel = (label: string) => (label === "Slack thread" ? "Slack" : label.replace(/^[^/#]+\/[^#]+#/u, "#"))

export function LinkChip(props: { link: TaskLink }) {
  const shown = describe(props.link)
  return (
    <span
      title={props.link.url}
      className="flex h-5 max-w-28 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium tabular-nums ring-1 ring-border"
    >
      <LinkMark shown={shown} />
      <span className="truncate">{shortLabel(shown.label)}</span>
    </span>
  )
}

export function TaskLinks(props: { links: TaskInfo["links"] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {props.links.map((link) => {
        const shown = describe(link)
        return (
          <Badge
            key={link.id}
            variant="outline"
            title={link.url}
            className="h-6 max-w-full gap-2 rounded-full bg-muted"
            render={<Link href={link.url} external appearance="plain" />}
          >
            <LinkMark shown={shown} />
            <span className="truncate">{shown.label}</span>
          </Badge>
        )
      })}
    </div>
  )
}
