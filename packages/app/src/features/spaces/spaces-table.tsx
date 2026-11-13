import type { SpaceInfo } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { IconArchive, IconCheck, IconCube, IconLock, IconPin, IconPinnedOff } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Avatar, AvatarFallback, AvatarGroup, AvatarImage } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { Spinner } from "@ren/ui/spinner"
import { Loading } from "@ren/ui/loading"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { TableCard, TableEmpty } from "../../components/page.js"
import { RowMenu } from "../../components/row-menu.js"
import { errorMessage } from "../../lib/errors.js"
import { initials, plural } from "../../lib/format.js"
import { RouterContext } from "../../lib/router-context.js"
import { useMe } from "../../lib/use-me.js"
import { isPersonal, usePinnedSpaces } from "../../lib/use-pinned-spaces.js"

function Members(props: { space: SpaceInfo }) {
  const { api } = RouterContext.useRouterContext()
  const space = props.space
  const people = useQuery({
    ...api["space-member"].list.queryOptions({ spaceId: space.id, status: "active", page: 1, pageSize: 3 }),
    enabled: space.kind !== "private" && space.membershipId !== null,
  })
  if (space.kind === "private") return <span className="text-muted-foreground">Only you</span>
  if (space.membershipId === null)
    return <span className="text-xs text-muted-foreground tabular-nums">{plural(space.memberCount, "member")}</span>
  const shown = people.isLoading
    ? Array.from({ length: Math.min(space.memberCount, 3) }, (_, index) => ({
        id: `sample-member-${index}`,
        name: "Team member",
        image: null,
      }))
    : (people.data?.items ?? []).flatMap((member) =>
        member.status === "active" ? [{ id: member.id, name: member.name, image: member.image }] : [],
      )
  return (
    <Loading loading={people.isLoading} label="Loading space members">
      {shown.length > 0 ? (
        <span
          className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums"
          aria-label={plural(space.memberCount, "member")}
        >
          <AvatarGroup className="-space-x-1 *:data-[slot=avatar]:bg-card *:data-[slot=avatar]:ring-card">
            {shown.map((member) => (
              <Avatar key={member.id} size="sm" title={member.name} className="data-[size=sm]:size-6">
                {member.image ? <AvatarImage src={member.image} alt="" /> : null}
                <AvatarFallback className="text-2xs">{initials(member.name)}</AvatarFallback>
              </Avatar>
            ))}
          </AvatarGroup>
          {space.memberCount > shown.length ? <span>+{space.memberCount - shown.length}</span> : null}
        </span>
      ) : null}
    </Loading>
  )
}

function Membership(props: { space: SpaceInfo; browsing: boolean }) {
  if (props.space.membershipId === null) return props.space.canJoin ? <JoinButton space={props.space} /> : null
  if (!props.browsing) return null
  return (
    <span className="flex items-center gap-1 text-xs">
      <IconCheck className="size-3.5" />
      Joined
    </span>
  )
}

function JoinButton(props: { space: SpaceInfo }) {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const me = useMe()
  const join = useMutation(api["space-member"].create.mutationOptions())
  const space = props.space
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={join.isPending}
      onClick={() =>
        join.mutate(
          { payload: { spaceId: space.id, userId: me.user.id } },
          {
            onSuccess: () => {
              toast.success(`Joined ${space.name}`)
              void navigate({ to: "/spaces/$spaceId", params: { spaceId: space.id } })
            },
            onError: (error) => toast.error("Could not join the space", { description: errorMessage(error) }),
          },
        )
      }
    >
      {join.isPending ? <Spinner data-icon="inline-start" /> : null}
      Join
    </Button>
  )
}

function SpaceRow(props: { space: SpaceInfo; browsing: boolean; pinned: boolean; onPin: (on: boolean) => void }) {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const archive = useMutation(api.space.archive.mutationOptions())
  const space = props.space
  const Icon = space.kind === "private" ? IconLock : IconCube
  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => void navigate({ to: "/spaces/$spaceId", params: { spaceId: space.id } })}
    >
      <TableCell>
        <span className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <Icon className="size-4" />
          </span>
          <Link
            to="/spaces/$spaceId"
            params={{ spaceId: space.id }}
            onClick={(event) => event.stopPropagation()}
            className="block min-w-0 truncate rounded-sm text-foreground outline-none focus-visible:underline"
          >
            {space.name}
          </Link>
          {props.pinned && !isPersonal(space) ? (
            <IconPin aria-label="Pinned" className="size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
        </span>
      </TableCell>
      <TableCell className="truncate text-muted-foreground" title={space.description || undefined}>
        {space.description || "-"}
      </TableCell>
      <TableCell>
        <Members space={space} />
      </TableCell>
      <TableCell onClick={(event) => event.stopPropagation()}>
        <span className="flex items-center justify-end gap-2">
          <Membership space={space} browsing={props.browsing} />
          {space.membershipId === null ? null : (
            <RowMenu
              label={`${space.name} actions`}
              items={[
                ...(isPersonal(space)
                  ? []
                  : [
                      props.pinned
                        ? { label: "Unpin", icon: IconPinnedOff, onSelect: () => props.onPin(false) }
                        : { label: "Pin", icon: IconPin, onSelect: () => props.onPin(true) },
                    ]),
                ...(space.canArchive
                  ? [
                      {
                        label: "Archive space",
                        icon: IconArchive,
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
                    ]
                  : []),
              ]}
            />
          )}
        </span>
      </TableCell>
    </TableRow>
  )
}

export function SpacesTable(props: { spaces: ReadonlyArray<SpaceInfo>; browsing: boolean; empty: string }) {
  const pins = usePinnedSpaces()
  return (
    <TableCard>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-1/3">Space</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="w-1/5">Members</TableHead>
            <TableHead className="w-32" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.spaces.length === 0 ? <TableEmpty columns={4}>{props.empty}</TableEmpty> : null}
          {pins.order(props.spaces).map((space) => (
            <SpaceRow
              key={space.id}
              space={space}
              browsing={props.browsing}
              pinned={pins.isPinned(space.id)}
              onPin={(on) => pins.pin(space, { on })}
            />
          ))}
        </TableBody>
      </Table>
    </TableCard>
  )
}
