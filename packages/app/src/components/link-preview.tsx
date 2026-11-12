import { createContext, use, type ComponentProps, type ReactNode } from "react"
import type { LinkPreviewInfo, LinkPreviewProvider } from "@ren/client"
import {
  IconCircle,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleDot,
  IconCircleHalf2,
  IconCircleX,
  IconFileText,
} from "@tabler/icons-react"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { buttonVariants } from "@ren/ui/button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@ren/ui/hover-card"
import { Link } from "@ren/ui/link"
import { formatRelative } from "@ren/ui/time"
import { cn } from "cn"
import { PullRequestIcon, pullRequestStateLabel } from "./pull-request-icon.js"

export const LinkPreviews = createContext<ReadonlyMap<string, LinkPreviewInfo> | undefined>(undefined)

const providers = { github: "GitHub", linear: "Linear", notion: "Notion" } as const satisfies Record<
  LinkPreviewProvider,
  string
>

const linearIcons = {
  triage: IconCircleDot,
  backlog: IconCircleDashed,
  unstarted: IconCircle,
  started: IconCircleHalf2,
  completed: IconCircleCheck,
  canceled: IconCircleX,
} as const

type Loaded = Exclude<LinkPreviewInfo, { kind: "unavailable" }>

const provider = (preview: LinkPreviewInfo): LinkPreviewProvider => {
  if (preview.kind === "unavailable") return preview.provider
  if (preview.kind === "linear_issue") return "linear"
  return preview.kind === "notion_page" ? "notion" : "github"
}

function PreviewIcon(props: { preview: Loaded; className: string }) {
  const preview = props.preview
  if (preview.kind === "github_pr") return <PullRequestIcon state={preview.state} className={props.className} />
  if (preview.kind === "github_issue")
    return preview.state === "open" ? (
      <IconCircleDot className={cn("text-chart-2", props.className)} />
    ) : (
      <IconCircleCheck className={cn("text-chart-6", props.className)} />
    )
  if (preview.kind === "linear_issue") {
    const Icon = linearIcons[preview.state.type]
    return (
      // oxlint-disable-next-line react/forbid-dom-props -- Linear sends the colour of each workflow state.
      <span className="inline-flex" style={{ color: preview.state.color }}>
        <Icon className={props.className} />
      </span>
    )
  }
  if (preview.icon?.type === "emoji")
    return (
      <span aria-hidden className={cn("inline-block text-center leading-none", props.className)}>
        {preview.icon.value}
      </span>
    )
  if (preview.icon?.type === "image")
    return (
      <img
        src={preview.icon.value}
        alt=""
        referrerPolicy="no-referrer"
        className={cn("inline-block rounded-xs object-cover", props.className)}
      />
    )
  return <IconFileText className={cn("text-muted-foreground", props.className)} />
}

const stateLabel = (preview: Loaded) => {
  if (preview.kind === "github_pr") return pullRequestStateLabel(preview.state)
  if (preview.kind === "linear_issue") return preview.state.name
  if (preview.kind === "notion_page") return "Page"
  return preview.state === "open" ? "Open" : "Closed"
}

const labelOf = (children: ReactNode) => {
  if (typeof children === "string") return children
  return Array.isArray(children) && children.length === 1 && typeof children[0] === "string" ? children[0] : undefined
}

function PreviewCard(props: { url: string; preview: LinkPreviewInfo }) {
  const preview = props.preview
  const name = providers[provider(preview)]
  const loaded = preview.kind === "unavailable" ? undefined : preview
  const person = loaded?.people.at(0)
  return (
    <div className="flex flex-col gap-1.5">
      {loaded ? (
        <>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <PreviewIcon preview={loaded} className="size-3.5 shrink-0" />
            <span>{stateLabel(loaded)}</span>
            {loaded.kind === "notion_page" ? null : (
              <>
                <span aria-hidden>·</span>
                <span className="min-w-0 truncate">{loaded.ref}</span>
              </>
            )}
          </div>
          <div className="line-clamp-2 text-sm font-medium">{loaded.title}</div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {person ? (
              <Avatar size="sm" className="data-[size=sm]:size-4">
                {person.avatarUrl ? <AvatarImage src={person.avatarUrl} alt="" /> : null}
                <AvatarFallback className="text-2xs">{person.name.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
            ) : null}
            <span className="min-w-0 truncate">
              {person ? `${person.name} · ` : ""}updated {formatRelative(loaded.updatedAt)}
            </span>
          </div>
        </>
      ) : null}
      {preview.kind === "unavailable" && preview.canConnect ? (
        <div className="text-sm">Connect {name} in this space to see its status</div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-muted-foreground">{props.url.replace(/^https?:\/\//u, "")}</span>
        <Link
          appearance="plain"
          href={props.url}
          external
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "shrink-0")}
        >
          Open in {name}
        </Link>
      </div>
    </div>
  )
}

export function PreviewedLink({ href, children, ...rest }: ComponentProps<"a">) {
  const previews = use(LinkPreviews)
  const preview = href ? previews?.get(href) : undefined
  const label = labelOf(children)
  const shown = preview && preview.kind !== "unavailable" && label === href ? preview.ref : children
  const link = (
    <Link href={href} external className="font-medium underline" {...rest}>
      {preview && preview.kind !== "unavailable" ? (
        <PreviewIcon preview={preview} className="mr-1 inline-block size-4 align-text-bottom" />
      ) : null}
      {shown}
    </Link>
  )
  if (!preview || !href) return link
  return (
    <HoverCard>
      <HoverCardTrigger render={link} />
      <HoverCardContent>
        <PreviewCard url={href} preview={preview} />
      </HoverCardContent>
    </HoverCard>
  )
}
