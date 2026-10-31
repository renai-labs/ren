import { useState } from "react"
import type { SpaceInfo } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { IconArchive, IconCube, IconDots, IconLock, IconMessage } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Avatar, AvatarFallback, AvatarGroup, AvatarImage } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { Card } from "@ren/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { useCatalog } from "../../lib/use-catalog.js"
import { useCanAdminister } from "../../lib/use-organization.js"
import { errorMessage } from "../../lib/errors.js"
import { initials, plural } from "../../lib/format.js"
import { RouterContext } from "../../lib/router-context.js"

function Stack(props: {
  label: string
  items: ReadonlyArray<{ id: string; name: string; image?: string | null | undefined }>
  total: number
}) {
  const shown = props.items.slice(0, 3)
  if (shown.length === 0) return null
  return (
    <span className="flex items-center gap-1.5" aria-label={props.label}>
      <AvatarGroup className="-space-x-1.5 *:data-[slot=avatar]:ring-card">
        {shown.map((item) => (
          <Avatar key={item.id} size="sm" className="data-[size=sm]:size-5">
            {item.image ? <AvatarImage src={item.image} alt="" /> : null}
            <AvatarFallback className="bg-secondary text-2xs">{initials(item.name)}</AvatarFallback>
          </Avatar>
        ))}
      </AvatarGroup>
      {props.total > shown.length ? <span>+{props.total - shown.length} more</span> : null}
    </span>
  )
}

function archiveBlocker(space: SpaceInfo, viewer: { readonly admin: boolean }) {
  if (space.kind === "private") return "Your personal space can’t be archived."
  if (viewer.admin) return "This is the default space. It can’t be archived."
  return "Only admins can archive this space."
}

function ArchiveItem(props: { space: SpaceInfo; onArchive: () => void }) {
  const admin = useCanAdminister()
  return (
    <DropdownMenuGroup>
      {props.space.canArchive ? (
        <DropdownMenuItem variant="destructive" onClick={props.onArchive}>
          <IconArchive />
          Archive space
        </DropdownMenuItem>
      ) : (
        <Tooltip>
          <TooltipTrigger render={<div />}>
            <DropdownMenuItem disabled>
              <IconArchive />
              Archive space
            </DropdownMenuItem>
          </TooltipTrigger>
          <TooltipContent side="left">{archiveBlocker(props.space, { admin })}</TooltipContent>
        </Tooltip>
      )}
    </DropdownMenuGroup>
  )
}

function SpaceMenu(props: { space: SpaceInfo }) {
  const { api } = RouterContext.useRouterContext()
  const space = props.space
  const archive = useMutation(api.space.archive.mutationOptions())
  const [archiving, setArchiving] = useState(false)
  return (
    <span className="relative -mt-1 -mr-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={`${space.name} actions`}
            />
          }
        >
          <IconDots />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <ArchiveItem space={space} onArchive={() => setArchiving(true)} />
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        confirmation={{
          title: `Archive “${space.name}”?`,
          description: "Its members lose access. Only the API can bring it back.",
          action: "Archive",
        }}
        onConfirm={() =>
          archive.mutateAsync(
            { id: space.id },
            {
              onSuccess: () => toast.success(`${space.name} archived`),
              onError: (error) => toast.error("Could not archive the space", { description: errorMessage(error) }),
            },
          )
        }
      />
    </span>
  )
}

export function SpaceCard(props: { space: SpaceInfo }) {
  const { api } = RouterContext.useRouterContext()
  const space = props.space
  const chats = useQuery(api.session.list.queryOptions({ spaceId: [space.id], page: 1, pageSize: 1 }))
  const reach = useQuery({ ...api["app-profile-reach"].space.profiles.queryOptions({ id: space.id }), retry: false })
  const people = useQuery({
    ...api["space-member"].list.queryOptions({ spaceId: space.id, status: "active", page: 1, pageSize: 3 }),
    enabled: space.kind !== "private" && space.membershipId !== null,
  })
  const catalog = useCatalog()
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
            className="truncate text-md/5 font-medium tracking-snug outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
          >
            {space.name}
          </Link>
          <span className="line-clamp-2 text-sm text-muted-foreground">{space.description || "No description"}</span>
        </div>
        <span className="flex h-6 shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums [&_svg]:size-3.5">
          <IconMessage />
          {plural(chats.data?.total ?? 0, "chat")}
        </span>
        <SpaceMenu space={space} />
      </div>
      <div className="flex h-5 items-center gap-4 text-xs text-muted-foreground tabular-nums">
        {space.kind === "private" ? null : (
          <Stack label={plural(space.memberCount, "member")} items={members} total={space.memberCount} />
        )}
        <Stack label={plural(apps.length, "app")} items={apps} total={apps.length} />
      </div>
    </Card>
  )
}
