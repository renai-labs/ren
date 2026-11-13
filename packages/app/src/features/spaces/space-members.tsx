import { useState } from "react"
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query"
import { IconPlus } from "@tabler/icons-react"
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
import { LoadMore } from "../../components/load-more.js"
import { PageActions, useShapeId } from "../../components/page.js"
import { Loading } from "@ren/ui/loading"
import { MembersTable } from "../../components/members-table.js"
import { PersonAvatar } from "../../components/person-avatar.js"
import { StatusBadge } from "../../components/status-badge.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
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

export function SpaceMembersTab() {
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
    <div className="flex flex-1 flex-col gap-4">
      <PageActions>
        <ToolbarSearch label="Search members" value={query} onChange={setQuery} />
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
    </div>
  )
}
