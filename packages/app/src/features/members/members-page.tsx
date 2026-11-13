import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { IconBan, IconCube, IconMailForward, IconPlus, IconShield } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Button } from "@ren/ui/button"
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Spinner } from "@ren/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Tabs } from "@ren/ui/tabs"
import { Textarea } from "@ren/ui/textarea"
import { FilterMenu, passes, type Filters } from "../../components/filter-menu.js"
import { LoadMore } from "../../components/load-more.js"
import { MembersTable } from "../../components/members-table.js"
import { Page, PageTabsList, PageTabsTrigger, TableCard, TableEmpty } from "../../components/page.js"
import { RowMenu } from "../../components/row-menu.js"
import { SpacesField } from "../../components/spaces-field.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { useMe } from "../../lib/use-me.js"
import { useMembers } from "../../lib/use-members.js"
import { useCanAdminister, useOrganization } from "../../lib/use-organization.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { errorMessage } from "../../lib/errors.js"
import { Search } from "../../lib/search.js"
import { useShown } from "../../lib/use-shown.js"
import { organizationOptions } from "../../lib/auth.js"
import { RouterContext } from "../../lib/router-context.js"
import { formatDate } from "@ren/ui/time"
import { isRole, plural, roleLabel, type Role } from "../../lib/format.js"
import { Choice, roleOptions, roles } from "../../components/settings-shared.js"

const route = getRouteApi("/_authed/_shell/settings/_admin/members")

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

function useAddableSpaces() {
  const spaces = useSpaces().joined.filter((space) => space.kind === "shared" && space.canAddMember)
  const general = spaces.reduce<(typeof spaces)[number] | undefined>(
    (oldest, space) => (!oldest || space.createdAt < oldest.createdAt ? space : oldest),
    undefined,
  )
  return { spaces, general }
}

function InviteDialog(props: {
  onInvite: (
    emails: ReadonlyArray<string>,
    role: Role,
    spaceIds: ReadonlyArray<string>,
  ) => Promise<{ failures: ReadonlyArray<string>; retry: ReadonlyArray<string> }>
}) {
  const { spaces, general } = useAddableSpaces()
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<Role>("member")
  const [text, setText] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <IconPlus />
        Add member
      </DialogTrigger>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            const emails = text
              .split(/[\s,]+/u)
              .map((email) => email.trim())
              .filter(Boolean)
            const invalid = emails.filter((email) => !emailPattern.test(email))
            if (emails.length === 0 || invalid.length > 0) {
              setError(invalid.length > 0 ? `Not a valid email: ${invalid.join(", ")}` : "Add at least one email.")
              return
            }
            setError("")
            setPending(true)
            void props
              .onInvite(
                emails,
                role,
                [...picked].filter((id) => id !== general?.id),
              )
              .then((outcome) => {
                setPending(false)
                setText(outcome.retry.join("\n"))
                if (outcome.failures.length === 0) {
                  setPicked(new Set())
                  setOpen(false)
                } else setError(outcome.failures.join("\n"))
              })
          }}
        >
          <DialogHeader>
            <DialogTitle>Add members</DialogTitle>
            <DialogDescription>
              Invitations are sent by email. Separate addresses with commas or new lines.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field data-invalid={error !== "" || undefined}>
              <FieldLabel htmlFor="invite-emails">Emails</FieldLabel>
              <Textarea
                id="invite-emails"
                required
                value={text}
                onChange={(event) => setText(event.currentTarget.value)}
                placeholder="name@company.com"
                className="min-h-20"
              />
              {error ? <FieldError className="whitespace-pre-wrap">{error}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel>Role</FieldLabel>
              <Choice
                label="Invite role"
                options={roleOptions}
                value={role}
                onChange={(value) => setRole(isRole(value) ? value : "member")}
                className="w-full"
              />
            </Field>
            {spaces.length > 0 ? (
              <SpacesField
                spaces={spaces}
                picked={picked}
                onPick={setPicked}
                locked={new Set(general ? [general.id] : [])}
              />
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Send invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MemberSpaces(props: { userId: string }) {
  const { api } = RouterContext.useRouterContext()
  const spaces = useSpaces()
  const memberships = useQuery(api["space-member"].list.queryOptions({ userId: props.userId, page: 1, pageSize: 100 }))
  const names = (memberships.data?.items ?? []).flatMap((member) => {
    const space = spaces.space(member.spaceId)
    return space?.kind === "shared" ? [space.name] : []
  })
  if (names.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={names.join(", ")}>
      <span className="truncate">{names.slice(0, 2).join(", ")}</span>
      {names.length > 2 ? <span className="shrink-0 text-xs text-muted-foreground">+{names.length - 2}</span> : null}
    </span>
  )
}

function AddToSpacesDialog(props: { member: { id: string; name: string }; onClose: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const { spaces } = useAddableSpaces()
  const memberships = useQuery(
    api["space-member"].list.queryOptions({ userId: props.member.id, page: 1, pageSize: 100 }),
  )
  const create = useMutation(api["space-member"].create.mutationOptions())
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const joined = new Set((memberships.data?.items ?? []).map((member) => member.spaceId))
  const available = memberships.isPending ? [] : spaces.filter((space) => !joined.has(space.id))
  const submit = async () => {
    setError("")
    setPending(true)
    const chosen = available.filter((space) => picked.has(space.id))
    const results = await Promise.allSettled(
      chosen.map((space) => create.mutateAsync({ payload: { spaceId: space.id, userId: props.member.id } })),
    )
    setPending(false)
    const failures = results.flatMap((result, index) =>
      result.status === "rejected" ? [`${chosen[index]?.name ?? "Space"}: ${errorMessage(result.reason)}`] : [],
    )
    const added = results.length - failures.length
    if (added > 0) toast.success(`Added ${props.member.name} to ${plural(added, "space")}`)
    if (failures.length === 0) props.onClose()
    else {
      setPicked(new Set())
      setError(failures.join("\n"))
    }
  }
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>Add {props.member.name} to spaces</DialogTitle>
            <DialogDescription>Pick from the shared spaces you are in.</DialogDescription>
          </DialogHeader>
          {!memberships.isPending && available.length === 0 ? (
            <p className="text-sm text-muted-foreground">{props.member.name} is already in all of your spaces.</p>
          ) : null}
          {available.length > 0 ? (
            <FieldGroup>
              <SpacesField spaces={available} picked={picked} onPick={setPicked} />
              {error ? <FieldError className="whitespace-pre-wrap">{error}</FieldError> : null}
            </FieldGroup>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending || picked.size === 0}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {picked.size > 1 ? `Add to ${picked.size} spaces` : "Add to space"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function MembersSettingsPage() {
  const { auth, api } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const me = useMe()
  const queryClient = useQueryClient()
  const organization = useOrganization()
  const members = useMembers().members
  const canAdminister = useCanAdminister()
  const tab = search.tab ?? "members"
  const [filters, setFilters] = useState<Filters>({})
  const [query, setQuery] = useState("")
  const [adding, setAdding] = useState<{ id: string; name: string }>()
  const createSpaceMember = useMutation(api["space-member"].create.mutationOptions())
  const rows = members
    .filter((member) => passes(filters, { role: [member.role] }))
    .filter((member) => Search.matches(query, member.name, member.email))
    .map((member) => ({
      id: member.id,
      memberId: member.memberId,
      name: member.name,
      email: member.email,
      image: member.image,
      role: member.role,
      you: member.id === me.user.id,
    }))
  const invitations = organization.invitations.filter((invitation) => invitation.status === "pending")
  const refresh = () =>
    // ast-grep-ignore: no-manual-invalidation -- members and invitations change through Better Auth
    queryClient.invalidateQueries({ queryKey: organizationOptions(auth, me.organization.id).queryKey })
  const shownRows = useShown(rows)
  const shownInvitations = useShown(invitations)
  const shown = tab === "members" ? shownRows : shownInvitations
  const openTab = (next: string) =>
    void navigate({ search: { tab: next === "invitations" ? "invitations" : "members" } })
  const memberCount = members.length
  const invitationCount = invitations.length
  const changeRole = async (memberId: string, name: string, role: string) => {
    const result = await auth.organization.updateMemberRole({ memberId, role, organizationId: me.organization.id })
    await refresh()
    if (result.error === null)
      toast.success(`${name} is now ${roleLabel[isRole(role) ? role : "member"].toLowerCase()}`)
    else toast.error("Couldn’t change role", { description: result.error.message })
  }
  const remove = async (memberId: string, name: string) => {
    const result = await auth.organization.removeMember({
      memberIdOrEmail: memberId,
      organizationId: me.organization.id,
    })
    await refresh()
    if (result.error === null) toast.success(`${name} removed from organization`)
    else toast.error("Couldn’t remove member", { description: result.error.message })
  }
  const spaces = useSpaces()
  const invite = async (emails: ReadonlyArray<string>, role: Role, spaceIds: ReadonlyArray<string>) => {
    const failures: string[] = []
    const retry: string[] = []
    for (const email of emails) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- invitations go one at a time so a failure names its email
      const result = await auth.organization.inviteMember({
        email,
        role,
        organizationId: me.organization.id,
        resend: false,
      })
      if (result.error !== null) {
        failures.push(`${email}: ${result.error.message ?? "failed"}`)
        retry.push(email)
        continue
      }
      for (const spaceId of spaceIds) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- spaces go one at a time so a failure names its space
        await createSpaceMember.mutateAsync({ payload: { spaceId, email } }).catch((error: unknown) => {
          failures.push(
            `${email}: could not add to ${spaces.spaceName(spaceId)}: ${errorMessage(error)}. Invited; add them from the space’s Add member dialog.`,
          )
        })
      }
    }
    await refresh()
    if (failures.length === 0) toast.success(emails.length === 1 ? "Invitation sent" : "Invitations sent")
    return { failures, retry }
  }
  const resend = async (email: string, role: string) => {
    const result = await auth.organization.inviteMember({
      email,
      role: isRole(role) ? role : "member",
      organizationId: me.organization.id,
      resend: true,
    })
    await refresh()
    if (result.error === null) toast.success(`Invitation resent to ${email}`)
    else toast.error("Couldn’t resend invitation", { description: result.error.message })
  }
  const revoke = async (invitationId: string, email: string) => {
    const result = await auth.organization.cancelInvitation({ invitationId })
    await refresh()
    if (result.error === null) toast.success(`Invitation to ${email} revoked`)
    else toast.error("Couldn’t revoke invitation", { description: result.error.message })
  }
  return (
    <Page
      title="Members"
      description="Everyone in your organization."
      tabs={
        <Tabs value={tab} onValueChange={(value: string) => openTab(value)}>
          <PageTabsList>
            <PageTabsTrigger value="members" count={memberCount}>
              Members
            </PageTabsTrigger>
            <PageTabsTrigger value="invitations" count={invitationCount}>
              Invitations
            </PageTabsTrigger>
          </PageTabsList>
        </Tabs>
      }
      actions={
        <>
          <ToolbarSearch label="Search members" value={query} onChange={setQuery} />
          <FilterMenu
            label="Filter members"
            properties={[{ key: "role", label: "Role", any: "Any", icon: IconShield, options: roles }]}
            value={filters}
            onChange={setFilters}
          />
          {canAdminister ? <InviteDialog onInvite={invite} /> : null}
        </>
      }
    >
      {tab === "members" ? (
        <MembersTable
          rows={shownRows.items}
          column={{
            heading: "Role",
            cell: (row) => (
              <Choice
                label="Role"
                options={roleOptions}
                value={row.role}
                size="sm"
                className="w-28 justify-between border-transparent bg-muted px-2 text-xs dark:bg-muted"
                disabled={row.you || !canAdminister}
                onChange={(role) => void changeRole(row.memberId, row.name, role)}
              />
            ),
          }}
          spaces={(row) => <MemberSpaces userId={row.id} />}
          items={(row) => [
            { label: "Add to spaces…", icon: IconCube, onSelect: () => setAdding({ id: row.id, name: row.name }) },
          ]}
          remove={(row) =>
            row.you || !canAdminister
              ? undefined
              : {
                  title: `Remove ${row.name}?`,
                  description: "They lose access to this organization and its spaces.",
                  action: "Remove",
                }
          }
          onRemove={(row) => remove(row.memberId, row.name)}
          empty="No members match these filters"
        />
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shownInvitations.items.length === 0 ? <TableEmpty columns={5}>No pending invitations</TableEmpty> : null}
              {shownInvitations.items.map((invite) => (
                <TableRow key={invite.id}>
                  <TableCell>{invite.email}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {roleLabel[isRole(invite.role) ? invite.role : "member"]}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">{formatDate(invite.createdAt)}</TableCell>
                  <TableCell>
                    {canAdminister ? (
                      <RowMenu
                        label="Invitation actions"
                        items={[
                          { label: "Resend", icon: IconMailForward, onSelect: () => resend(invite.email, invite.role) },
                          {
                            label: "Revoke",
                            icon: IconBan,
                            onSelect: () => revoke(invite.id, invite.email),
                            confirm: {
                              title: "Revoke invitation?",
                              description: `The invitation to ${invite.email} stops working.`,
                              action: "Revoke",
                            },
                          },
                        ]}
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
      <LoadMore more={shown.more} onMore={shown.next} />
      {adding ? <AddToSpacesDialog key={adding.id} member={adding} onClose={() => setAdding(undefined)} /> : null}
    </Page>
  )
}
