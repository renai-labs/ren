import type { PullRequestInfo, TaskInfo } from "@ren/client"
import type { ComponentType } from "react"
import { TaskLink } from "@ren/schema/task-link"
import { IconWorld } from "@tabler/icons-react"
import { GitHubMark, LinearMark, SlackMark } from "../../icons/brands.js"
import { PullRequestIcon, pullRequestStateLabel } from "../../components/pull-request-icon.js"
import { Badge } from "@ren/ui/badge"
import { Link } from "@ren/ui/link"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"

type LinkInfo = TaskInfo["links"][number]

type Mark = ComponentType<{ className?: string }>

const marks: Record<LinkInfo["kind"], Mark> = {
  github_pr: GitHubMark,
  github_issue: GitHubMark,
  linear_issue: LinearMark,
  slack_thread: SlackMark,
  url: IconWorld,
}

const describe = (link: LinkInfo): { mark: Mark; label: string } => ({
  mark: URL.canParse(link.url) ? marks[link.kind] : IconWorld,
  label: TaskLink.label(link),
})

function LinkMark(props: { link: LinkInfo; shown: ReturnType<typeof describe>; pull?: PullRequestInfo | undefined }) {
  return (
    <span className="flex shrink-0">
      {props.link.kind === "github_pr" ? (
        <PullRequestIcon state={props.pull?.state} className="size-3.5" />
      ) : (
        <props.shown.mark className="size-3.5 text-foreground" />
      )}
    </span>
  )
}

export function LinkChip(props: { link: LinkInfo }) {
  const shown = describe(props.link)
  return (
    <span
      title={props.link.url}
      className="flex h-5 max-w-28 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium tabular-nums ring-1 ring-border"
    >
      <LinkMark link={props.link} shown={shown} />
      <span className="truncate">{TaskLink.shortLabel(props.link)}</span>
    </span>
  )
}

const pill = "h-6 max-w-full gap-2 rounded-full bg-muted"

export function TaskLinks(props: {
  links: TaskInfo["links"]
  pullRequests: ReadonlyArray<PullRequestInfo> | undefined
}) {
  const pulls = new Map(props.pullRequests?.map((pull) => [pull.url, pull]))
  return (
    <div className="flex flex-wrap gap-1.5">
      {props.links.map((link) => {
        const shown = describe(link)
        const pull = pulls.get(link.url)
        const content = (
          <>
            <LinkMark link={link} shown={shown} pull={pull} />
            <span className="truncate">{shown.label}</span>
          </>
        )
        if (link.kind !== "github_pr")
          return (
            <Badge
              key={link.id}
              variant="outline"
              title={link.url}
              className={pill}
              render={<Link href={link.url} external appearance="plain" />}
            >
              {content}
            </Badge>
          )
        return (
          <Tooltip key={link.id}>
            <TooltipTrigger
              render={
                <Badge
                  variant="outline"
                  className={pill}
                  render={<Link href={link.url} external appearance="plain" />}
                />
              }
            >
              {content}
            </TooltipTrigger>
            <TooltipContent>
              {pull?.title && pull.state ? `${pull.title} · ${pullRequestStateLabel(pull.state)}` : link.url}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
