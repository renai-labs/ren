import type { ReactNode } from "react"
import type { SpaceInfo } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { IconClock, IconCube, IconLock, IconMessage } from "@tabler/icons-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from "@/components/ui/avatar"
import { Card } from "@/components/ui/card"
import { RowMenu } from "@/components/ren/row-menu"
import { useCatalog } from "@/hooks/use-catalog"
import { useNow } from "@/hooks/use-now"
import { api, errorMessage } from "@/lib/api"
import { formatRelative, initials, plural } from "@/lib/format"

function Fact(props: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 [&_svg]:size-3.5">
      {props.icon}
      {props.children}
    </span>
  )
}

function Stack(props: {
  items: ReadonlyArray<{ id: string; name: string; image?: string | null | undefined }>
  total: number
  label?: string | undefined
}) {
  const shown = props.items.slice(0, 3)
  return (
    <span className="flex items-center gap-1.5">
      {shown.length > 0 ? (
        <AvatarGroup className="-space-x-1.5 *:data-[slot=avatar]:ring-card *:data-[slot=avatar-group-count]:ring-card">
          {shown.map((item) => (
            <Avatar key={item.id} size="sm" className="data-[size=sm]:size-5">
              {item.image ? <AvatarImage src={item.image} alt="" /> : null}
              <AvatarFallback className="bg-secondary text-[10px]">{initials(item.name)}</AvatarFallback>
            </Avatar>
          ))}
          {props.total > shown.length ? (
            <AvatarGroupCount className="size-5 text-[10px] group-has-data-[size=sm]/avatar-group:size-5">
              +{props.total - shown.length}
            </AvatarGroupCount>
          ) : null}
        </AvatarGroup>
      ) : null}
      {props.label}
    </span>
  )
}

export function SpaceCard(props: { space: SpaceInfo }) {
  const space = props.space
  const now = useNow()
  const chats = useQuery(api.session.list.queryOptions({ spaceId: space.id, page: 1, pageSize: 1 }))
  const reach = useQuery({ ...api["app-profile-reach"].space.profiles.queryOptions({ id: space.id }), retry: false })
  const people = useQuery({
    ...api["space-member"].list.queryOptions({ spaceId: space.id, status: "active", page: 1, pageSize: 3 }),
    enabled: space.kind !== "private" && space.membershipId !== null,
  })
  const catalog = useCatalog()
  const archive = useMutation(api.space.archive.mutationOptions())
  const latest = chats.data?.items.at(0)
  const apps = [...new Set((reach.data?.profiles ?? []).map((profile) => profile.appId))].map((appId) => ({
    id: appId,
    name: catalog.appOf(appId)?.name ?? appId,
    image: catalog.appOf(appId)?.icon,
  }))
  const members = (people.data?.items ?? []).flatMap((member) =>
    member.status === "active" ? [{ id: member.id, name: member.name, image: member.image }] : [],
  )
  const Icon = space.kind === "private" ? IconLock : IconCube
  return (
    <Card className="relative gap-6 border p-5 shadow-soft ring-0 transition-[background-color,scale] duration-150 ease-out hover:bg-muted/40 active:scale-[0.99] motion-reduce:active:scale-100">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-6 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Link
            to="/spaces/$spaceId"
            params={{ spaceId: space.id }}
            className="truncate text-[15px]/5 font-medium tracking-[-0.01em] outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
          >
            {space.name}
          </Link>
          <span className="line-clamp-2 text-sm text-muted-foreground">{space.description || "No description"}</span>
        </div>
        {space.canArchive ? (
          <span className="relative -mt-1 -mr-1">
            <RowMenu
              label={`${space.name} actions`}
              className="flex text-muted-foreground"
              items={[
                {
                  label: "Archive space",
                  onSelect: () =>
                    archive.mutateAsync(
                      { id: space.id },
                      {
                        onSuccess: () => toast.success(`${space.name} archived`),
                        onError: (error) =>
                          toast.error("Could not archive the space", { description: errorMessage(error) }),
                      },
                    ),
                  confirm: {
                    title: `Archive “${space.name}”?`,
                    description: "Its members lose access. Only the API can bring it back.",
                    action: "Archive",
                  },
                },
              ]}
            />
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-2.5 text-xs text-muted-foreground tabular-nums">
        <div className="flex items-center gap-4">
          <Fact icon={<IconMessage />}>{plural(chats.data?.total ?? 0, "chat")}</Fact>
          <Fact icon={<IconClock />}>{latest ? formatRelative(latest.updatedAt, now) : "Not used yet"}</Fact>
        </div>
        <div className="flex h-5 items-center gap-4">
          {space.kind === "private" ? null : <Stack items={members} total={space.memberCount} />}
          <Stack items={apps} total={apps.length} label={apps.length === 0 ? "No apps" : plural(apps.length, "app")} />
        </div>
      </div>
    </Card>
  )
}
