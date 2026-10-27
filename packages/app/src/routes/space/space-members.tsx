import { useState } from "react"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { ListPagination } from "@/components/ren/list-pagination"
import { MembersTable } from "@/components/ren/members-table"
import { PersonAvatar } from "@/components/ren/person-avatar"
import { StatusBadge } from "@/components/ren/status-badge"
import { ToolbarSearch } from "@/components/ren/toolbar-search"
import { useMe } from "@/hooks/use-me"
import { useOrganization } from "@/hooks/use-organization"
import { api, errorMessage, pageSize, pickerPageSize } from "@/lib/api"
import { currentPage, lastPageAfterRemoval } from "@/lib/pagination"
import { useSpace } from "@/routes/space/use-space"

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/members")

interface Candidate {
  readonly value: string
  readonly name: string
  readonly email: string
  readonly image: string | undefined
  readonly target: { readonly userId: string } | { readonly email: string }
}

function useSpaceMembers() {
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
  return {
    space,
    page,
    total,
    stale: members.isPlaceholderData,
    query,
    setQuery,
    rows: rows.filter((row) => `${row.name} ${row.email}`.toLowerCase().includes(needle)),
    adding,
    setAdding,
    candidates,
    candidatesLoading: everyone.isPending,
    creating: create.isPending,
    add: (candidate: Candidate) =>
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
      ),
    remove: (row: { id: string; name: string }) =>
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
      ),
  }
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
      <DialogTrigger render={<Button size="xs" className="h-6.5" />}>
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
          <Command className="rounded-lg border">
            <CommandInput placeholder="Search by name or email…" />
            <CommandList className="pt-1">
              <CommandEmpty>{props.loading ? "Loading…" : "Everyone is already in this space."}</CommandEmpty>
              {props.candidates.map((member) => (
                <CommandItem
                  key={member.value}
                  value={`${member.name} ${member.email}`}
                  data-checked={selected === member.value}
                  onSelect={() => setSelected(member.value)}
                >
                  <PersonAvatar name={member.name} image={member.image} />
                  {member.name}
                  <span className="text-muted-foreground">{member.email}</span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
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
  const page = useSpaceMembers()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end gap-1">
        <ToolbarSearch label="Search members" value={page.query} onChange={page.setQuery} />
        {page.space.canAddMember ? (
          <AddSpaceMemberDialog
            open={page.adding}
            candidates={page.candidates}
            loading={page.candidatesLoading}
            pending={page.creating}
            onOpenChange={page.setAdding}
            onAdd={page.add}
          />
        ) : null}
      </div>
      <MembersTable
        rows={page.rows}
        stale={page.stale}
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
          row.you || !page.space.canRemoveMember
            ? undefined
            : {
                title: `Remove ${row.name} from ${page.space.name}?`,
                description: "They lose access to this space’s chats, apps and keys.",
                action: "Remove",
              }
        }
        onRemove={page.remove}
        empty={page.query ? `Nothing matches “${page.query.trim()}”` : "No members"}
      />
      <div className="flex items-center justify-between gap-4 empty:hidden">
        <ListPagination page={page.page} pageSize={pageSize} total={page.total} noun="member" />
      </div>
    </div>
  )
}
