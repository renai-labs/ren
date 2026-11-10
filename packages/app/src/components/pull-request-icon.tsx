import type { PullRequestState } from "@ren/client"
import {
  IconGitMerge,
  IconGitPullRequest,
  IconGitPullRequestClosed,
  IconGitPullRequestDraft,
} from "@tabler/icons-react"
import { cn } from "cn"

const states = {
  open: { icon: IconGitPullRequest, label: "Open", className: "text-chart-2" },
  draft: { icon: IconGitPullRequestDraft, label: "Draft", className: "text-muted-foreground" },
  merged: { icon: IconGitMerge, label: "Merged", className: "text-chart-6" },
  closed: { icon: IconGitPullRequestClosed, label: "Closed", className: "text-destructive" },
} as const

export const pullRequestStateLabel = (state: PullRequestState) => states[state].label

export function PullRequestIcon(props: { state: PullRequestState | null | undefined; className?: string }) {
  const shown = props.state ? states[props.state] : { icon: IconGitPullRequest, className: "text-foreground" }
  return <shown.icon className={cn(shown.className, props.className)} />
}
