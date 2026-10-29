import type { ReactNode } from "react"
import type { ReferenceInfo, SpaceInfo } from "@ren/client"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { IconBrandGithub, IconCube, IconLock, IconMessage } from "@tabler/icons-react"
import { AvatarGroup } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PersonAvatar } from "@/components/ren/person-avatar"
import { RowMenu } from "@/components/ren/row-menu"
import { useCatalog } from "@/hooks/use-catalog"
import { useNow } from "@/hooks/use-now"
import { api } from "@/lib/api"
import { gaps } from "@/lib/apps"
import { formatRelative, plural } from "@/lib/format"
import { sessionTitle } from "@/lib/sessions"
import { cn } from "@/lib/utils"
import { chooseSpaceCard, useSpaceCard, type SpaceCardLook } from "@/stores/ui"

const isPrivate = (space: SpaceInfo) => space.kind === "private"

function useSpaceStats(space: SpaceInfo) {
  const personal = isPrivate(space)
  const catalog = useCatalog()
  const now = useNow()
  const chats = useQuery(api.session.list.queryOptions({ spaceId: space.id, page: 1, pageSize: 3 }))
  const people = useQuery({
    ...api["space-member"].list.queryOptions({ spaceId: space.id, status: "active", page: 1, pageSize: 4 }),
    enabled: !personal && space.membershipId !== null,
  })
  const reach = useQuery({ ...api["app-profile-reach"].space.profiles.queryOptions({ id: space.id }), retry: false })
  const settings = useQuery({ ...api["space-settings"].get.queryOptions({ idOrSlug: space.id }), retry: false })
  const schedules = useQuery({
    ...api.schedule.list.queryOptions({ spaceId: space.id, status: "active", page: 1, pageSize: 1 }),
    retry: false,
  })
  const profiles = reach.data?.profiles ?? []
  const apps = [
    ...new Map(
      profiles.map((profile) => {
        const app = catalog.appOf(profile.appId)
        return [profile.appId, { id: profile.appId, name: app?.name ?? profile.appSlug, icon: app?.icon ?? null }]
      }),
    ).values(),
  ]
  const latest = chats.data?.items.at(0)
  return {
    personal,
    now,
    chats: chats.data?.total ?? 0,
    latest: latest ? { title: sessionTitle(latest.title), at: latest.updatedAt, busy: latest.status === "busy" } : null,
    recent: (chats.data?.items ?? []).map((chat) => ({
      id: chat.id,
      title: sessionTitle(chat.title),
      at: chat.updatedAt,
      busy: chat.status === "busy",
    })),
    members: (people.data?.items ?? []).flatMap((member) => (member.status === "active" ? [member.name] : [])),
    apps,
    pending: profiles.filter((profile) => gaps(profile).length > 0).length,
    repositories: settings.data?.settings.references ?? [],
    schedules: schedules.data?.total ?? 0,
  }
}

type Stats = ReturnType<typeof useSpaceStats>

const surface =
  "relative gap-0 border p-5 shadow-soft ring-0 transition-[background-color,scale] duration-150 ease-out hover:bg-muted/40 active:scale-[0.99] motion-reduce:active:scale-100"

function SpaceTile(props: { space: SpaceInfo; size?: "sm" | "md" | undefined }) {
  const Icon = isPrivate(props.space) ? IconLock : IconCube
  return (
    <Icon
      className={cn("shrink-0 text-muted-foreground", props.size === "sm" ? "size-4" : "size-5")}
      strokeWidth={1.75}
    />
  )
}

function SpaceLink(props: { space: SpaceInfo }) {
  return (
    <Link
      to="/spaces/$spaceId"
      params={{ spaceId: props.space.id }}
      className="truncate outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
    >
      {props.space.name}
    </Link>
  )
}

function Status(props: { stats: Stats }) {
  const stats = props.stats
  if (stats.latest?.busy)
    return (
      <Badge variant="secondary" className="relative gap-1.5 font-normal">
        <span className="size-1.5 rounded-full bg-chart-2 motion-safe:animate-pulse" />
        Working
      </Badge>
    )
  if (stats.pending === 0) return null
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Badge variant="secondary" className="relative gap-1.5 font-normal text-chart-3 tabular-nums" />}
      >
        <span className="size-1.5 rounded-full bg-chart-3" />
        {stats.pending} to connect
      </TooltipTrigger>
      <TooltipContent>{plural(stats.pending, "app account")} not connected yet</TooltipContent>
    </Tooltip>
  )
}

function SpaceMenu(props: { space: SpaceInfo }) {
  const navigate = useNavigate()
  const go = (to: "/spaces/$spaceId/members" | "/spaces/$spaceId/apps" | "/spaces/$spaceId/credentials") => () =>
    void navigate({ to, params: { spaceId: props.space.id } })
  return (
    <span className="relative opacity-0 transition-opacity duration-150 group-hover/card:opacity-100 focus-within:opacity-100 has-aria-expanded:opacity-100">
      <RowMenu
        label={`${props.space.name} actions`}
        items={[
          ...(isPrivate(props.space) ? [] : [{ label: "Members", onSelect: go("/spaces/$spaceId/members") }]),
          { label: "Apps", onSelect: go("/spaces/$spaceId/apps") },
          { label: "Keys", onSelect: go("/spaces/$spaceId/credentials") },
        ]}
        className="flex text-muted-foreground"
      />
    </span>
  )
}

function Heading(props: {
  space: SpaceInfo
  stats: Stats
  caption?: ReactNode | undefined
  status?: boolean | undefined
}) {
  return (
    <div className="flex items-center gap-3">
      <SpaceTile space={props.space} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px]/5 font-medium tracking-[-0.01em]">
          <SpaceLink space={props.space} />
        </span>
        <span className="truncate text-[13px]/4.5 text-muted-foreground">
          {props.caption ?? (props.space.description || (props.stats.personal ? "Only you" : "No description"))}
        </span>
      </div>
      {props.status === false ? null : <Status stats={props.stats} />}
      <SpaceMenu space={props.space} />
    </div>
  )
}

function RepoChip(props: { reference: ReferenceInfo }) {
  const path = props.reference.repository.replace(/^https?:\/\/(www\.)?github\.com\//u, "").replace(/\.git$/u, "")
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <IconBrandGithub className="size-3.5 shrink-0" />
      <span className="truncate">{path}</span>
    </span>
  )
}

function AppTiles(props: { apps: Stats["apps"]; max?: number | undefined; size?: "sm" | "md" | undefined }) {
  const max = props.max ?? 4
  const small = props.size !== "md"
  const tile = small ? "size-5 rounded-[5px]" : "size-7 rounded-md"
  return (
    <span className="flex items-center gap-1">
      {props.apps.slice(0, max).map((app) => (
        <Tooltip key={app.id}>
          <TooltipTrigger
            render={
              <span
                className={cn(
                  "relative flex items-center justify-center overflow-hidden bg-secondary text-[10px] inset-ring inset-ring-foreground/10",
                  tile,
                )}
              />
            }
          >
            {app.icon ? <img src={app.icon} alt="" className="size-full object-cover" /> : app.name.charAt(0)}
          </TooltipTrigger>
          <TooltipContent>{app.name}</TooltipContent>
        </Tooltip>
      ))}
      {props.apps.length > max ? (
        <span className="text-xs text-muted-foreground tabular-nums">+{props.apps.length - max}</span>
      ) : null}
    </span>
  )
}

function PeopleStack(props: { space: SpaceInfo; stats: Stats }) {
  const count = props.space.memberCount
  const shown = count > 4 ? props.stats.members.slice(0, 3) : props.stats.members
  if (props.stats.personal) return <span>Only you</span>
  return (
    <span className="flex items-center gap-2">
      {shown.length > 0 ? (
        <AvatarGroup className="-space-x-1.5 *:data-[slot=avatar]:ring-card">
          {shown.map((name) => (
            <PersonAvatar key={name} name={name} className="bg-secondary text-[10px] font-medium text-foreground" />
          ))}
        </AvatarGroup>
      ) : null}
      {plural(count, "member")}
    </span>
  )
}

const lastActive = (stats: Stats) =>
  stats.latest ? (stats.latest.busy ? "Working now" : formatRelative(stats.latest.at, stats.now)) : "No chats yet"

function OverviewCard(props: { space: SpaceInfo; stats: Stats }) {
  const { space, stats } = props
  const repo = stats.repositories.at(0)
  return (
    <Card className={cn(surface, "gap-5")}>
      <Heading space={space} stats={stats} />
      <div className="flex min-w-0 flex-col gap-1">
        <span className={cn("truncate text-sm", stats.latest ? "font-medium" : "text-muted-foreground")}>
          {stats.latest?.title ?? "No chats yet"}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {stats.latest
            ? `${lastActive(stats)} · ${plural(stats.chats, "chat")}`
            : `Created ${formatRelative(space.createdAt, stats.now)}`}
        </span>
      </div>
      {repo || stats.apps.length > 0 ? (
        <div className="flex min-w-0 items-center justify-between gap-4">
          {repo ? <RepoChip reference={repo} /> : <span />}
          {stats.apps.length > 0 ? <AppTiles apps={stats.apps} /> : null}
        </div>
      ) : null}
    </Card>
  )
}

function CompactCard(props: { space: SpaceInfo; stats: Stats }) {
  const { space, stats } = props
  return (
    <Card className={cn(surface, "flex-row items-center gap-3 px-3 py-2.5")}>
      <SpaceTile space={space} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium tracking-[-0.005em]">
          <SpaceLink space={space} />
        </span>
        <span className="truncate text-xs text-muted-foreground tabular-nums">
          {[plural(stats.chats, "chat"), stats.apps.length ? plural(stats.apps.length, "app") : ""]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <Status stats={stats} />
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {stats.latest && !stats.latest.busy ? lastActive(stats) : null}
      </span>
    </Card>
  )
}

function Metric(props: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-2xl/7 font-medium tracking-[-0.02em] tabular-nums">{props.value}</span>
      <span className="text-xs text-muted-foreground">{props.label}</span>
    </div>
  )
}

function MetricsCard(props: { space: SpaceInfo; stats: Stats }) {
  const { space, stats } = props
  return (
    <Card className={cn(surface, "gap-6")}>
      <Heading space={space} stats={stats} caption={lastActive(stats)} />
      <div className="grid grid-cols-3 gap-4">
        <Metric label={stats.chats === 1 ? "Chat" : "Chats"} value={stats.chats} />
        <Metric label={space.memberCount === 1 ? "Member" : "Members"} value={space.memberCount} />
        <Metric label={stats.apps.length === 1 ? "App" : "Apps"} value={stats.apps.length} />
      </div>
    </Card>
  )
}

function AppsCard(props: { space: SpaceInfo; stats: Stats }) {
  const { space, stats } = props
  return (
    <Card className={cn(surface, "gap-5")}>
      <Heading space={space} stats={stats} status={false} />
      <div className="flex min-h-7 items-center gap-3">
        {stats.apps.length > 0 ? (
          <>
            <AppTiles apps={stats.apps} max={6} size="md" />
            {stats.pending > 0 ? (
              <span className="text-xs text-chart-3 tabular-nums">{stats.pending} to connect</span>
            ) : null}
          </>
        ) : (
          <span className="text-sm text-muted-foreground">No apps yet</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-4 border-t pt-4 text-xs text-muted-foreground">
        <PeopleStack space={space} stats={stats} />
        <span className="flex items-center gap-1.5 tabular-nums">
          <IconMessage className="size-3.5" />
          {plural(stats.chats, "chat")}
        </span>
      </div>
    </Card>
  )
}

function ActivityCard(props: { space: SpaceInfo; stats: Stats }) {
  const { space, stats } = props
  return (
    <Card className={cn(surface, "gap-4")}>
      <Heading space={space} stats={stats} />
      <ul className="flex flex-col">
        {stats.recent.length === 0 ? (
          <li className="py-1.5 text-sm text-muted-foreground">No chats yet</li>
        ) : (
          stats.recent.map((chat) => (
            <li key={chat.id} className="flex items-center gap-2.5 py-1.5 text-sm">
              <span
                className={cn("size-1.5 shrink-0 rounded-full", chat.busy ? "bg-chart-2" : "bg-muted-foreground/30")}
              />
              <span className="min-w-0 flex-1 truncate">{chat.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {chat.busy ? "Now" : formatRelative(chat.at, stats.now)}
              </span>
            </li>
          ))
        )}
      </ul>
      <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <PeopleStack space={space} stats={stats} />
        <span className="tabular-nums">{plural(stats.chats, "chat")}</span>
      </div>
    </Card>
  )
}

const cards: Record<Exclude<SpaceCardLook, "current">, (props: { space: SpaceInfo; stats: Stats }) => ReactNode> = {
  vercel: OverviewCard,
  compact: CompactCard,
  metrics: MetricsCard,
  apps: AppsCard,
  activity: ActivityCard,
}

export function SpaceCardPrototype(props: { space: SpaceInfo; look: Exclude<SpaceCardLook, "current"> }) {
  const stats = useSpaceStats(props.space)
  const Look = cards[props.look]
  return <Look space={props.space} stats={stats} />
}

const looks: ReadonlyArray<{ value: SpaceCardLook; label: string }> = [
  { value: "current", label: "Current" },
  { value: "vercel", label: "Overview" },
  { value: "compact", label: "Compact" },
  { value: "metrics", label: "Metrics" },
  { value: "apps", label: "Apps" },
  { value: "activity", label: "Activity" },
]

const isLook = (value: unknown): value is SpaceCardLook => looks.some((look) => look.value === value)

export function SpaceCardSwitcher() {
  const look = useSpaceCard()
  return (
    <Tabs
      value={look}
      onValueChange={(value) => {
        if (isLook(value)) chooseSpaceCard(value)
      }}
      className="fixed top-2.5 left-1/2 z-50 -translate-x-1/2 max-md:hidden"
    >
      <TabsList className="shadow-overlay">
        <span className="px-2 text-xs">Cards</span>
        {looks.map((item) => (
          <TabsTrigger key={item.value} value={item.value} className="px-2.5 text-xs">
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
