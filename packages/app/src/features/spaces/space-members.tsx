import { useState } from "react"
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query"
import { IconPlus } from "@tabler/icons-react"
import { getRouteApi } from "@tanstack/react-router"
import type { SpaceInfo, SpaceJoinRequestInfo } from "@ren/client"
import { toast } from "@ren/ui/sonner"
import { Button } from "@ren/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@ren/ui/command"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@ren/ui/dialog"
import { Spinner } from "@ren/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Tabs } from "@ren/ui/tabs"
import { formatDateTime, formatRelative } from "@ren/ui/time"
import { LoadMore } from "../../components/load-more.js"
import { PageActions, PageTabsList, PageTabsTrigger, TableCard, TableEmpty, useShapeId } from "../../components/page.js"
import { Loading } from "@ren/ui/loading"
import { MembersTable } from "../../components/members-table.js"
import { PersonAvatar } from "../../components/person-avatar.js"
import { StatusBadge } from "../../components/status-badge.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { InviteLinkDialog } from "./invite-link-dialog.js"
import { useMe } from "../../lib/use-me.js"
import { useOrganization } from "../../lib/use-organization.js"
import { errorMessage } from "../../lib/errors.js"
import { pageSize, pickerPageSize } from "../../lib/pagination.js"
import { Pages } from "../../lib/pages.js"
import { Search } from "../../lib/search.js"
import { useSpace } from "./use-space.js"
import { RouterContext } from "../../lib/router-context.js"
import { Loader } from "../../lib/loader.js"

interface Candidate {
  readonly value: string
  readonly name: string
  readonly email: string
  readonly image: string | undefined
  readonly target: { readonly userId: string } | { readonly email: string }
}

function CandidateList(props: {
  candidates: ReadonlyArray<Candidate>
  loading: boolean
  selected: ReadonlySet<string>
  onSelect: (value: string) => void
}) {
  return (
    <Command className="rounded-none bg-transparent p-0 **:data-[slot=command-input-wrapper]:mx-0 **:data-[slot=command-input-wrapper]:mt-0">
      <CommandInput placeholder="Search by name or email…" />
      <CommandList className="pt-1">
        <CommandEmpty>{props.loading ? "Loading…" : "Everyone is already in this space."}</CommandEmpty>
        <CommandGroup className="p-0">
          {props.candidates.map((member) => (
            <CommandItem
              key={member.value}
              value={`${member.name} ${member.email}`}
              data-checked={props.selected.has(member.value)}
              onSelect={() => props.onSelect(member.value)}
            >
              <PersonAvatar name={member.name} image={member.image} />
              {member.name}
              <span className="text-muted-foreground">{member.email}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

function AddSpaceMemberDialog(props: {
  open: boolean
  candidates: ReadonlyArray<Candidate>
  loading: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (candidates: ReadonlyArray<Candidate>) => void
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const chosen = props.candidates.filter((each) => selected.has(each.value))
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogTrigger render={<Button />}>
        <IconPlus />
        Add member
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Pick someone from the organization, or someone invited to it. Invited people join once they accept.
          </DialogDescription>
        </DialogHeader>
        <CandidateList
          candidates={props.candidates}
          loading={props.loading}
          selected={selected}
          onSelect={(value) =>
            setSelected((current) => {
              const next = new Set(current)
              if (!next.delete(value)) next.add(value)
              return next
            })
          }
        />
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button disabled={chosen.length === 0 || props.pending} onClick={() => props.onAdd(chosen)}>
            {props.pending ? <Spinner data-icon="inline-start" /> : null}
            {chosen.length > 1 ? `Add ${chosen.length} members` : "Add member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/members")

export function SpaceMembersTab() {
  const { client } = RouterContext.useRouterContext()
  const space = useSpace()
  const navigate = route.useNavigate()
  const tab = route.useSearch({ select: (search) => search.tab ?? "members" })
  const requests = useInfiniteQuery({ ...Pages.spaceJoinRequests(client, space.id), ...Loader.required })
  return (
    <div className="flex flex-1 flex-col gap-4">
      <Tabs
        value={tab}
        onValueChange={(value: string) =>
          void navigate({ search: value === "requests" ? { tab: "requests" } : {}, replace: true })
        }
      >
        <PageTabsList>
          <PageTabsTrigger value="members">Members</PageTabsTrigger>
          <PageTabsTrigger value="requests" count={requests.data?.pages.at(0)?.total}>
            Requests
          </PageTabsTrigger>
        </PageTabsList>
      </Tabs>
      {tab === "requests" ? <SpaceRequests /> : <SpaceMembers />}
    </div>
  )
}

function RequestRow(props: { request: SpaceJoinRequestInfo; space: SpaceInfo }) {
  const { api } = RouterContext.useRouterContext()
  const request = props.request
  const approve = useMutation({
    ...api["space-join-request"].approve.mutationOptions(),
    onSuccess: () => toast.success(`${request.name} added to ${props.space.name}`),
    onError: (error) => toast.error("Could not approve the request", { description: errorMessage(error) }),
  })
  const decline = useMutation({
    ...api["space-join-request"].decline.mutationOptions(),
    onSuccess: () => toast.success(`Declined ${request.name}`),
    onError: (error) => toast.error("Could not decline the request", { description: errorMessage(error) }),
  })
  const deciding = approve.isPending || decline.isPending
  return (
    <TableRow>
      <TableCell>
        <span className="flex min-w-0 items-center gap-3">
          <PersonAvatar name={request.name} image={request.image ?? undefined} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{request.name}</span>
            <span className="truncate text-xs text-muted-foreground" title={request.email}>
              {request.email}
            </span>
          </span>
        </span>
      </TableCell>
      <TableCell className="truncate text-muted-foreground" title={request.note ?? undefined}>
        {request.note ?? "No note"}
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">
        <time dateTime={request.createdAt} title={formatDateTime(request.createdAt)}>
          {formatRelative(request.createdAt)}
        </time>
      </TableCell>
      <TableCell>
        <span className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={deciding} onClick={() => decline.mutate({ id: request.id })}>
            {decline.isPending ? <Spinner data-icon="inline-start" /> : null}
            Decline
          </Button>
          <Button size="sm" disabled={deciding} onClick={() => approve.mutate({ id: request.id })}>
            {approve.isPending ? <Spinner data-icon="inline-start" /> : null}
            Approve
          </Button>
        </span>
      </TableCell>
    </TableRow>
  )
}

function SpaceRequests() {
  const { client } = RouterContext.useRouterContext()
  const space = useSpace()
  const [query, setQuery] = useState("")
  const requests = useInfiniteQuery({ ...Pages.spaceJoinRequests(client, space.id), ...Loader.required })
  const shapeId = useShapeId("requests")
  const rows = (requests.data?.pages ?? [])
    .flatMap((page) => page.items)
    .filter((request) => Search.matches(query, request.name, request.email, request.note))
  return (
    <>
      <PageActions>
        <ToolbarSearch label="Search requests" value={query} onChange={setQuery} />
      </PageActions>
      <Loading id={shapeId} loading={requests.isPending} label="Loading requests">
        <TableCard>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-1/3">Person</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="w-28">Requested</TableHead>
                <TableHead className="w-48" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableEmpty columns={4}>{Search.empty(query, "No requests to join")}</TableEmpty>
              ) : null}
              {rows.map((request) => (
                <RequestRow key={request.id} request={request} space={space} />
              ))}
            </TableBody>
          </Table>
        </TableCard>
      </Loading>
      <LoadMore
        more={requests.hasNextPage}
        loading={requests.isFetchingNextPage}
        onMore={() => void requests.fetchNextPage()}
      />
    </>
  )
}

function SpaceMembers() {
  const { api, client } = RouterContext.useRouterContext()
  const space = useSpace()
  const me = useMe()
  const [query, setQuery] = useState("")
  const [adding, setAdding] = useState(false)
  const [bulk, setBulk] = useState(false)
  const members = useInfiniteQuery({ ...Pages.spaceMembers(client, space.id), ...Loader.required })
  const everyone = useQuery({
    ...api["space-member"].list.queryOptions({ spaceId: space.id, page: 1, pageSize: pickerPageSize }),
    enabled: adding,
  })
  const organization = useOrganization()
  const create = useMutation(api["space-member"].create.mutationOptions())
  const remove = useMutation(api["space-member"].archive.mutationOptions())
  const joined = new Set(
    (everyone.data?.items ?? []).map((member) =>
      member.status === "active" ? member.userId : member.email.toLowerCase(),
    ),
  )
  const candidates: ReadonlyArray<Candidate> = [
    ...organization.members
      .filter((member) => !joined.has(member.userId))
      .map((member) => ({
        value: member.userId,
        name: member.user.name || member.user.email,
        email: member.user.email,
        image: member.user.image ?? undefined,
        target: { userId: member.userId },
      })),
    ...organization.invitations
      .filter((invitation) => invitation.status === "pending" && !joined.has(invitation.email.toLowerCase()))
      .map((invitation) => ({
        value: invitation.email,
        name: invitation.email,
        email: "Invited",
        image: undefined,
        target: { email: invitation.email },
      })),
  ]
  const rows = (members.data?.pages ?? [])
    .flatMap((page) => page.items)
    .map((member) =>
      member.status === "active"
        ? {
            id: member.id,
            name: member.name,
            email: member.email,
            image: member.image ?? undefined,
            you: member.userId === me.user.id,
            pending: false,
          }
        : { id: member.id, name: member.email, email: member.email, you: false, pending: true },
    )
  const sampleRows = Array.from({ length: Math.min(space.memberCount, pageSize) }, (_, index) => ({
    id: `sample-${index}`,
    name: "Team member",
    email: "member@company.com",
    you: false,
    pending: false,
  }))
  const shapeId = useShapeId("members")
  const candidatesLoading = everyone.isPending
  const creating = bulk
  const add = async (chosen: ReadonlyArray<Candidate>) => {
    setBulk(true)
    const results = await Promise.allSettled(
      chosen.map((candidate) => create.mutateAsync({ payload: { spaceId: space.id, ...candidate.target } })),
    )
    setBulk(false)
    const failed = results.filter((result) => result.status === "rejected")
    const added = chosen.filter((_, index) => results[index]?.status === "fulfilled")
    if (added.length > 0) {
      setAdding(false)
      const only = added.length === 1 ? added[0] : undefined
      if (!only) toast.success(`${added.length} members added to space`)
      else if ("userId" in only.target) toast.success(`${only.name} added to space`)
      else toast.success(`${only.name} will join when they accept their invite`)
    }
    if (failed.length > 0) toast.error("Could not add the member", { description: errorMessage(failed[0]?.reason) })
  }
  return (
    <>
      <PageActions>
        <ToolbarSearch label="Search members" value={query} onChange={setQuery} />
        {space.membershipId && space.kind === "shared" ? <InviteLinkDialog /> : null}
        {space.canAddMember ? (
          <AddSpaceMemberDialog
            open={adding}
            candidates={candidates}
            loading={candidatesLoading}
            pending={creating}
            onOpenChange={setAdding}
            onAdd={(chosen) => void add(chosen)}
          />
        ) : null}
      </PageActions>
      <Loading id={shapeId} loading={members.isPending} label="Loading members">
        <MembersTable
          rows={(members.isPending ? sampleRows : rows).filter((row) => Search.matches(query, row.name, row.email))}
          column={{
            heading: "Status",
            cell: (row) =>
              row.pending ? (
                <StatusBadge tone="neutral">Pending</StatusBadge>
              ) : (
                <StatusBadge tone="ok">Active</StatusBadge>
              ),
          }}
          remove={(row) =>
            row.you || !space.canRemoveMember
              ? undefined
              : {
                  title: `Remove ${row.name} from ${space.name}?`,
                  description: "They lose access to this space’s chats, apps and keys.",
                  action: "Remove",
                }
          }
          onRemove={(row: { id: string; name: string }) =>
            remove.mutateAsync(
              { id: row.id },
              {
                onSuccess: () => toast.success(`${row.name} removed`),
                onError: (error) => toast.error("Could not remove the member", { description: errorMessage(error) }),
              },
            )
          }
          empty={Search.empty(query, "No members")}
        />
      </Loading>
      <LoadMore
        more={members.hasNextPage}
        loading={members.isFetchingNextPage}
        onMore={() => void members.fetchNextPage()}
      />
    </>
  )
}
