import type { ReferenceInfo, SpaceInfo } from "@ren/client"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  IconActivity,
  IconBrandGithub,
  IconCube,
  IconExclamationMark,
  IconLock,
  IconMessage,
} from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { RowMenu } from "@/components/ren/row-menu"
import { useNow } from "@/hooks/use-now"
import { api } from "@/lib/api"
import { gaps } from "@/lib/apps"
import { formatRelative, formatShortDate, plural } from "@/lib/format"
import { sessionTitle } from "@/lib/sessions"
import { cn } from "@/lib/utils"

const day = 86_400_000

const when = (at: string, now: number) => (now - Date.parse(at) < day ? formatRelative(at, now) : formatShortDate(at))

function StatusRing(props: { busy: boolean; pending: number }) {
  const state = props.busy
    ? {
        label: "Ren is working in a chat",
        icon: <IconActivity className="size-4" />,
        ring: "border-chart-1/30 text-chart-1",
      }
    : props.pending > 0
      ? {
          label: `${plural(props.pending, "app account")} not connected`,
          icon: <IconExclamationMark className="size-4" />,
          ring: "border-transparent bg-chart-3/15 text-chart-3",
        }
      : { label: "Idle", icon: <IconActivity className="size-4" />, ring: "text-muted-foreground" }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={state.label}
            className={cn(
              "relative flex size-9 shrink-0 items-center justify-center rounded-full border-2",
              state.ring,
            )}
          />
        }
      >
        {props.busy ? (
          <span className="absolute -inset-0.5 rounded-full border-2 border-transparent border-t-chart-1 motion-safe:animate-spin" />
        ) : null}
        {state.icon}
      </TooltipTrigger>
      <TooltipContent>{state.label}</TooltipContent>
    </Tooltip>
  )
}

function RepoChip(props: { reference: ReferenceInfo }) {
  const path = props.reference.repository.replace(/^https?:\/\/(www\.)?github\.com\//u, "").replace(/\.git$/u, "")
  return (
    <Badge variant="secondary" className="h-6 max-w-56 rounded-full px-2 font-normal">
      <IconBrandGithub />
      <span className="truncate">{path}</span>
    </Badge>
  )
}

export function SpaceCard(props: { space: SpaceInfo }) {
  const space = props.space
  const personal = space.kind === "private"
  const navigate = useNavigate()
  const now = useNow()
  const chats = useQuery(api.session.list.queryOptions({ spaceId: space.id, page: 1, pageSize: 1 }))
  const reach = useQuery({ ...api["app-profile-reach"].space.profiles.queryOptions({ id: space.id }), retry: false })
  const settings = useQuery({ ...api["space-settings"].get.queryOptions({ idOrSlug: space.id }), retry: false })
  const latest = chats.data?.items.at(0)
  const total = chats.data?.total ?? 0
  const repo = settings.data?.settings.references?.at(0)
  const pending = (reach.data?.profiles ?? []).filter((profile) => gaps(profile).length > 0).length
  const Icon = personal ? IconLock : IconCube
  const go = (to: "/spaces/$spaceId/members" | "/spaces/$spaceId/apps" | "/spaces/$spaceId/credentials") => () =>
    void navigate({ to, params: { spaceId: space.id } })
  return (
    <Card className="relative gap-0 border p-5 shadow-soft ring-0 transition-[background-color,scale] duration-150 ease-out hover:bg-muted/40 active:scale-[0.99] motion-reduce:active:scale-100">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-7 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Link
            to="/spaces/$spaceId"
            params={{ spaceId: space.id }}
            className="truncate text-[15px]/5 font-medium tracking-[-0.01em] outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
          >
            {space.name}
          </Link>
          <span className="truncate text-sm text-muted-foreground">
            {space.description || (personal ? "Only you" : plural(space.memberCount, "member"))}
          </span>
        </div>
        <StatusRing busy={latest?.status === "busy"} pending={pending} />
        <span className="relative flex h-9 items-center">
          <RowMenu
            label={`${space.name} actions`}
            items={[
              ...(personal ? [] : [{ label: "Members", onSelect: go("/spaces/$spaceId/members") }]),
              { label: "Apps", onSelect: go("/spaces/$spaceId/apps") },
              { label: "Keys", onSelect: go("/spaces/$spaceId/credentials") },
            ]}
            className="flex text-muted-foreground"
          />
        </span>
      </div>
      <div className="mt-3 flex h-6">{repo ? <RepoChip reference={repo} /> : null}</div>
      <div className="mt-4 flex min-w-0 flex-col gap-1">
        <span className={cn("truncate text-[15px]/5", latest ? "font-medium" : "text-muted-foreground")}>
          {latest ? sessionTitle(latest.title) : "No chats yet"}
        </span>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums">
          {latest ? when(latest.updatedAt, now) : when(space.createdAt, now)}
          {total > 0 ? (
            <>
              <span aria-hidden>·</span>
              <IconMessage className="size-3.5" />
              {plural(total, "chat")}
            </>
          ) : null}
        </span>
      </div>
    </Card>
  )
}
