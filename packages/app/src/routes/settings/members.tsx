import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { IconBuilding, IconCube, IconPlus, IconSearch, IconShield } from "@tabler/icons-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { FilterMenu, passes, type Filters } from "@/components/ren/filter-menu"
import { ListPagination } from "@/components/ren/list-pagination"
import { MembersTable } from "@/components/ren/members-table"
import { Page, PageScope, PageTabsList, PageTabsTrigger, TableCard, TableEmpty } from "@/components/ren/page"
import { RowMenu } from "@/components/ren/row-menu"
import { ToolbarSearch } from "@/components/ren/toolbar-search"
import { useMe } from "@/hooks/use-me"
import { useMembers } from "@/hooks/use-members"
import { useCanAdminister, useOrganization } from "@/hooks/use-organization"
import { useSpaces } from "@/hooks/use-spaces"
import { api, pageSize, pickerPageSize } from "@/lib/api"
import { organizationOptions } from "@/lib/auth"
import { auth } from "@/lib/auth"
import { formatDate, isRole, roleLabel, type Role } from "@/lib/format"
import { currentPage } from "@/lib/pagination"
import { Choice, roles } from "@/routes/settings/settings-shared"

const route = getRouteApi("/_authed/settings/members")

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

function useMembersPage() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const me = useMe()
  const queryClient = useQueryClient()
  const organization = useOrganization()
  const members = useMembers().members
  const spaces = useSpaces()
  const canAdminister = useCanAdminister()
  const tab = search.tab ?? "members"
  const page = currentPage(search)
  const [scope, setScope] = useState("org")
  const [filters, setFilters] = useState<Filters>({})
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState("")
  const inSpace = useQuery({
    ...api["space-member"].list.queryOptions({ spaceId: scope, status: "active", page: 1, pageSize: pickerPageSize }),
    enabled: scope !== "org" })
  const spaceUsers = new Set(
    (inSpace.data?.items ?? []).flatMap((member) => (member.status === "active" ? [member.userId] : [])),
  )
  const needle = query.trim().toLowerCase()
  const rows = members
    .filter((member) => passes(filters, { role: [member.role] }))
    .filter((member) => scope === "org" || spaceUsers.has(member.id))
    .filter((member) => !needle || `${member.name} ${member.email}`.toLowerCase().includes(needle))
    .map((member) => ({
      id: member.id,
      memberId: member.memberId,
      name: member.name,
      email: member.email,
      image: member.image,
      role: member.role,
      you: member.id === me.user.id }))
  const invitations = organization.invitations.filter((invitation) => invitation.status === "pending")
  const refresh = () => queryClient.invalidateQueries({ queryKey: organizationOptions(me.organization.id).queryKey })
  const visibleRows = rows.slice((page - 1) * pageSize, page * pageSize)
  const visibleInvitations = invitations.slice((page - 1) * pageSize, page * pageSize)
  return {
    organizationId: me.organization.id,
    organizationName: me.organization.name,
    tab,
    page,
    total: tab === "members" ? rows.length : invitations.length,
    openTab: (next: string) =>
      void navigate({ search: { tab: next === "invitations" ? "invitations" : "members" } }),
    scope,
    setScope: (next: string) => {
      setScope(next)
      void navigate({ search: (previous) => ({ ...previous, page: undefined }) })
    },
    scopes: [
      { value: "org", label: me.organization.name, icon: IconBuilding },
      ...spaces.spaces.map((space) => ({ value: space.id, label: space.name, icon: IconCube })),
    ],
    scopeName: spaces.spaceName(scope),
    filters,
    setFilters,
    searching,
    setSearching,
    query,
    setQuery,
    memberCount: members.length,
    invitationCount: invitations.length,
    rows: visibleRows,
    invitations: visibleInvitations,
    canAdminister,
    changeRole: async (memberId: string, name: string, role: string) => {
      const result = await auth.organization.updateMemberRole({ memberId, role, organizationId: me.organization.id })
      await refresh()
      if (result.error === null) toast.success(`${name} is now ${roleLabel[isRole(role) ? role : "member"].toLowerCase()}`)
      else toast.error("Couldn’t change role", { description: result.error.message })
    },
    remove: async (memberId: string, name: string) => {
      const result = await auth.organization.removeMember({
        memberIdOrEmail: memberId,
        organizationId: me.organization.id })
      await refresh()
      if (result.error === null) toast.success(`${name} removed from organization`)
      else toast.error("Couldn’t remove member", { description: result.error.message })
    },
    invite: async (emails: ReadonlyArray<string>, role: Role) => {
      const failures: string[] = []
      for (const email of emails) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- invitations go one at a time so a failure names its email
        const result = await auth.organization.inviteMember({
          email,
          role,
          organizationId: me.organization.id,
          resend: false })
        if (result.error !== null) failures.push(`${email}: ${result.error.message ?? "failed"}`)
      }
      await refresh()
      if (failures.length === 0) toast.success(emails.length === 1 ? "Invitation sent" : "Invitations sent")
      return failures
    },
    resend: async (email: string, role: string) => {
      const result = await auth.organization.inviteMember({
        email,
        role: isRole(role) ? role : "member",
        organizationId: me.organization.id,
        resend: true })
      await refresh()
      if (result.error === null) toast.success(`Invitation resent to ${email}`)
      else toast.error("Couldn’t resend invitation", { description: result.error.message })
    },
    revoke: async (invitationId: string, email: string) => {
      const result = await auth.organization.cancelInvitation({ invitationId })
      await refresh()
      if (result.error === null) toast.success(`Invitation to ${email} revoked`)
      else toast.error("Couldn’t revoke invitation", { description: result.error.message })
    } }
}

function InviteDialog(props: { onInvite: (emails: ReadonlyArray<string>, role: Role) => Promise<ReadonlyArray<string>> }) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<Role>("member")
  const [text, setText] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="xs" className="h-6.5" />}>
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
            void props.onInvite(emails, role).then((failures) => {
              setPending(false)
              if (failures.length === 0) {
                setText("")
                setOpen(false)
              } else setError(failures.join("\n"))
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
                options={roles}
                value={role}
                onChange={(value) => setRole(isRole(value) ? value : "member")}
                className="w-full"
              />
            </Field>
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

export function MembersSettingsPage() {
  const page = useMembersPage()
  return (
    <Page
      title="Members"
      description={page.scope === "org" ? "Everyone in your organization." : `Everyone in ${page.scopeName}.`}
      scope={<PageScope label="Scope" value={page.scope} options={page.scopes} onChange={page.setScope} />}
      leading={
        <Tabs value={page.tab} onValueChange={(value: string) => page.openTab(value)}>
          <PageTabsList>
            <PageTabsTrigger value="members" count={page.memberCount}>
              Members
            </PageTabsTrigger>
            <PageTabsTrigger value="invitations" count={page.invitationCount}>
              Invitations
            </PageTabsTrigger>
          </PageTabsList>
        </Tabs>
      }
      actions={
        <>
          {page.searching ? (
            <ToolbarSearch label="Search members" value={page.query} onChange={page.setQuery} />
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label="Search members"
              onClick={() => page.setSearching(true)}
            >
              <IconSearch />
            </Button>
          )}
          <FilterMenu
            label="Filter members"
            properties={[{ key: "role", label: "Role", any: "Any", icon: IconShield, options: roles }]}
            value={page.filters}
            onChange={page.setFilters}
          />
          {page.canAdminister ? <InviteDialog onInvite={page.invite} /> : null}
        </>
      }
      footer={
        <ListPagination
          page={page.page}
          pageSize={pageSize}
          total={page.total}
          noun={page.tab === "members" ? "member" : "invitation"}
        />
      }
    >
      {page.tab === "members" ? (
        <MembersTable
          rows={page.rows}
          column={{
            heading: "Role",
            cell: (row) => (
              <Choice
                label="Role"
                options={roles}
                value={row.role}
                size="sm"
                className="w-28 justify-between border-transparent bg-muted px-2 text-xs dark:bg-muted"
                disabled={row.you || !page.canAdminister}
                onChange={(role) => void page.changeRole(row.memberId, row.name, role)}
              />
            ) }}
          remove={(row) =>
            row.you || !page.canAdminister
              ? undefined
              : {
                  title: `Remove ${row.name}?`,
                  description: "They lose access to this organization and its spaces.",
                  action: "Remove" }
          }
          onRemove={(row) => page.remove(row.memberId, row.name)}
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
              {page.invitations.length === 0 ? <TableEmpty columns={5}>No pending invitations</TableEmpty> : null}
              {page.invitations.map((invite) => (
                <TableRow key={invite.id}>
                  <TableCell>{invite.email}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {roleLabel[isRole(invite.role) ? invite.role : "member"]}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">{formatDate(invite.createdAt)}</TableCell>
                  <TableCell>
                    {page.canAdminister ? (
                      <RowMenu
                        label="Invitation actions"
                        items={[
                          { label: "Resend", onSelect: () => page.resend(invite.email, invite.role) },
                          {
                            label: "Revoke",
                            onSelect: () => page.revoke(invite.id, invite.email),
                            confirm: {
                              title: "Revoke invitation?",
                              description: `The invitation to ${invite.email} stops working.`,
                              action: "Revoke" } },
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
    </Page>
  )
}
