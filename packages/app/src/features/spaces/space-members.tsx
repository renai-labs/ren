import { useState } from "react"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
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
import { Field, FieldLabel } from "@ren/ui/field"
import { Spinner } from "@ren/ui/spinner"
import { ListPagination } from "../../components/list-pagination.js"
import { MembersTable } from "../../components/members-table.js"
import { PersonAvatar } from "../../components/person-avatar.js"
import { StatusBadge } from "../../components/status-badge.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { useMe } from "../../lib/use-me.js"
import { useOrganization } from "../../lib/use-organization.js"
import { errorMessage } from "../../lib/errors.js"
import { pageSize, pickerPageSize, currentPage, lastPageAfterRemoval } from "../../lib/pagination.js"
import { useSpace } from "./use-space.js"
import { RouterContext } from "../../lib/router-context.js"
import { Loader } from "../../lib/loader.js"

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/members")

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
  selected: string | undefined
  onSelect: (value: string) => void
}) {
  return (
    <Command className="rounded-lg border">
      <CommandInput placeholder="Search by name or email…" />
      <CommandList className="pt-1">
        <CommandEmpty>{props.loading ? "Loading…" : "Everyone is already in this space."}</CommandEmpty>
        <CommandGroup className="p-0">
          {props.candidates.map((member) => (
            <CommandItem
              key={member.value}
              value={`${member.name} ${member.email}`}
              data-checked={props.selected === member.value}
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
  onAdd: (candidate: Candidate) => void
}) {
  const [selected, setSelected] = useState<string>()
  const candidate = props.candidates.find((each) => each.value === selected)
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
        <Field>
          <FieldLabel>Person</FieldLabel>
          <CandidateList
            candidates={props.candidates}
            loading={props.loading}
            selected={selected}
            onSelect={setSelected}
          />
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button disabled={!candidate || props.pending} onClick={() => candidate && props.onAdd(candidate)}>
            {props.pending ? <Spinner data-icon="inline-start" /> : null}
            Add member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SpaceMembersTab() {
  const { api } = RouterContext.useRouterContext()
  const space = useSpace()
  const me = useMe()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const page = currentPage(search)
  const [query, setQuery] = useState("")
  const [adding, setAdding] = useState(false)
  const members = useQuery({
    ...api["space-member"].list.queryOptions({ spaceId: space.id, page, pageSize }),
    placeholderData: keepPreviousData,
    ...Loader.required,
  })
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
  const rows = (members.data?.items ?? []).map((member) =>
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
  const needle = query.trim().toLowerCase()
  const total = members.data?.total ?? 0
  const stale = members.isPlaceholderData
  const candidatesLoading = everyone.isPending
  const creating = create.isPending
  const add = (candidate: Candidate) =>
    create.mutate(
      { payload: { spaceId: space.id, ...candidate.target } },
      {
        onSuccess: () => {
          setAdding(false)
          toast.success(
            "userId" in candidate.target
              ? `${candidate.name} added to space`
              : `${candidate.name} will join when they accept their invite`,
          )
        },
        onError: (error) => toast.error("Could not add the member", { description: errorMessage(error) }),
      },
    )
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end gap-1">
        <ToolbarSearch label="Search members" value={query} onChange={setQuery} />
        {space.canAddMember ? (
          <AddSpaceMemberDialog
            open={adding}
            candidates={candidates}
            loading={candidatesLoading}
            pending={creating}
            onOpenChange={setAdding}
            onAdd={add}
          />
        ) : null}
      </div>
      <MembersTable
        rows={rows.filter((row) => `${row.name} ${row.email}`.toLowerCase().includes(needle))}
        stale={stale}
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
              onSuccess: () => {
                toast.success(`${row.name} removed`)
                const next = lastPageAfterRemoval(page, total, pageSize)
                if (next !== page) void navigate({ search: (previous) => ({ ...previous, page: next }) })
              },
              onError: (error) => toast.error("Could not remove the member", { description: errorMessage(error) }),
            },
          )
        }
        empty={query ? `Nothing matches “${query.trim()}”` : "No members"}
      />
      <div className="flex items-center justify-between gap-4 empty:hidden">
        <ListPagination page={page} pageSize={pageSize} total={total} noun="member" />
      </div>
    </div>
  )
}
