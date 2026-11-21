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
import type { OrganizationInviteLinkInfo } from "@ren/client"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { FilterMenu, type Filters } from "../../components/filter-menu.js"
import { FilterMatch } from "@ren/util/filter-match"
import { LoadMore } from "../../components/load-more.js"
import { MembersTable } from "../../components/members-table.js"
import { Page, PageTabsList, PageTabsTrigger, TableCard, TableEmpty } from "../../components/page.js"
import { RowMenu } from "../../components/row-menu.js"
import { SpacesField } from "../../components/spaces-field.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { TruncatedText } from "../../components/truncated-text.js"
import { useMe } from "../../lib/use-me.js"
import { useMembers } from "../../lib/use-members.js"
import { useCanAdminister, useOrganization } from "../../lib/use-organization.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { errorMessage } from "../../lib/errors.js"
import { Search } from "@ren/schema/search"
import { useShown } from "../../lib/use-shown.js"
import { organizationOptions } from "../../lib/auth.js"
import { RouterContext } from "../../lib/router-context.js"
import { formatDate } from "@ren/ui/time"
import { isRole, plural, roleLabel, type Role } from "../../lib/format.js"
import { Choice, roleOptions, roles, type ChoiceOption } from "../../components/settings-shared.js"
import { OrganizationInviteLinkDialog } from "./organization-invite-link-dialog.js"
import { OrganizationInviteLinksTable } from "./organization-invite-links-table.js"

const route = getRouteApi("/_authed/_shell/settings/_admin/members")

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

const emailSeparators = /[,;\n]+/u

const angledEmail = /<([^<>]+)>/u

const whitespace = /\s+/u

const withArticle: Record<Role, string> = { owner: "an owner", admin: "an admin", member: "a member" }

type RoleOptions = ReadonlyArray<ChoiceOption<Role>>

function useRefresh() {
  const { auth } = RouterContext.useRouterContext()
  const me = useMe()
  const queryClient = useQueryClient()
  return () =>
    // ast-grep-ignore: no-manual-invalidation -- members and invitations change through Better Auth
    queryClient.invalidateQueries({ queryKey: organizationOptions(auth, me.organization.id).queryKey })
}

function useAddableSpaces() {
  const spaces = useSpaces().joined.filter((space) => space.kind === "shared" && space.canAddMember)
  const general = spaces.reduce<(typeof spaces)[number] | undefined>(
    (oldest, space) => (!oldest || space.createdAt < oldest.createdAt ? space : oldest),
    undefined,
  )
  return { spaces, general }
}

function InviteDialog(props: { roles: RoleOptions }) {
  const { auth, api } = RouterContext.useRouterContext()
  const me = useMe()
  const refresh = useRefresh()
  const names = useSpaces()
  const createSpaceMember = useMutation(api["space-member"].create.mutationOptions())
  const addable = useAddableSpaces()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
  const [role, setRole] = useState<Role>("member")
  const [text, setText] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const emails = [
    ...new Set(
      text
        .split(emailSeparators)
        .flatMap((entry) => (angledEmail.exec(entry)?.[1] ?? entry).split(whitespace))
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
  const fail = (form: HTMLFormElement, message: string) => {
    setError(message)
    const field = form.elements.namedItem("emails")
    if (field instanceof HTMLTextAreaElement) field.focus()
  }
  const invite = async () => {
    const spaceIds = [...picked].filter((id) => id !== addable.general?.id)
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
        failures.push(`Couldn’t invite ${email}. ${result.error.message ?? "Check the address and try again."}`)
        retry.push(email)
        continue
      }
      for (const spaceId of spaceIds) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- spaces go one at a time so a failure names its space
        await createSpaceMember.mutateAsync({ payload: { spaceId, email } }).catch((cause: unknown) => {
          failures.push(
            `Invited ${email}, but couldn’t add them to ${names.spaceName(spaceId)}: ${errorMessage(cause)}. Add them from that space’s Members page.`,
          )
        })
      }
    }
    await refresh()
    if (failures.length === 0)
      toast.success(emails.length === 1 ? "Invitation sent" : `${emails.length} invitations sent`)
    return { failures, retry }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError("")
        setOpen(next)
      }}
    >
      <DialogTrigger render={<Button />}>
        <IconPlus />
        Invite members
      </DialogTrigger>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            const form = event.currentTarget
            const invalid = emails.filter((email) => !emailPattern.test(email))
            if (emails.length === 0) {
              fail(form, "Add at least one email, like name@company.com.")
              return
            }
            if (invalid.length > 0) {
              fail(form, `Not a valid email: ${invalid.join(", ")}. Use the format name@company.com.`)
              return
            }
            setError("")
            setPending(true)
            void invite().then((outcome) => {
              setPending(false)
              setText(outcome.retry.join("\n"))
              if (outcome.failures.length > 0) {
                fail(form, outcome.failures.join("\n"))
                return
              }
              setPicked(new Set())
              setOpen(false)
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>Invite members</DialogTitle>
            <DialogDescription>
              Invitations are sent by email. Separate addresses with commas or new lines.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field data-invalid={error !== "" || undefined}>
              <FieldLabel htmlFor="invite-emails">Emails</FieldLabel>
              <Textarea
                id="invite-emails"
                name="emails"
                required
                value={text}
                aria-invalid={error === "" ? undefined : true}
                aria-describedby={error === "" ? undefined : "invite-emails-error"}
                onChange={(event) => setText(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
                    event.currentTarget.form?.requestSubmit()
                }}
                placeholder="name@company.com"
                className="min-h-20"
              />
              {error ? (
                <FieldError id="invite-emails-error" className="whitespace-pre-wrap">
                  {error}
                </FieldError>
              ) : null}
            </Field>
            <Field>
              <FieldLabel>Role</FieldLabel>
              <Choice
                label="Invite role"
                options={props.roles}
                value={role}
                onChange={(value) => setRole(isRole(value) ? value : "member")}
                className="w-full"
              />
            </Field>
            {addable.spaces.length > 0 ? (
              <SpacesField
                spaces={addable.spaces}
                picked={picked}
                onPick={setPicked}
                locked={new Set(addable.general ? [addable.general.id] : [])}
              />
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {emails.length > 1 ? `Invite ${emails.length} people` : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RoleCell(props: {
  member: { memberId: string; name: string; role: Role }
  roles: RoleOptions
  editable: boolean
}) {
  const { auth } = RouterContext.useRouterContext()
  const me = useMe()
  const refresh = useRefresh()
  const [next, setNext] = useState<Role>()
  const changeRole = async (member: { memberId: string; name: string; role: Role }, role: Role): Promise<void> => {
    const result = await auth.organization.updateMemberRole({
      memberId: member.memberId,
      role,
      organizationId: me.organization.id,
    })
    await refresh()
    if (result.error !== null) {
      toast.error("Couldn’t change role", { description: result.error.message, duration: Infinity })
      return
    }
    toast.success(`${member.name} is now ${withArticle[role]}`, {
      duration: Infinity,
      action: { label: "Undo", onClick: () => void changeRole({ ...member, role }, member.role) },
    })
  }
  if (!props.editable)
    return <span className="flex h-7 items-center text-muted-foreground">{roleLabel[props.member.role]}</span>
  return (
    <>
      <Choice
        label={`Role for ${props.member.name}`}
        options={props.roles}
        value={props.member.role}
        size="sm"
        className="-ml-2 gap-1 border-transparent bg-transparent px-2 text-muted-foreground hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground dark:bg-transparent dark:hover:bg-muted"
        onChange={(role) => {
          if (role === "owner" || props.member.role === "owner") setNext(role)
          else void changeRole(props.member, role)
        }}
      />
      <ConfirmDialog
        open={next !== undefined}
        onOpenChange={(open) => {
          if (!open) setNext(undefined)
        }}
        confirmation={{
          title: `Make ${props.member.name} ${withArticle[next ?? props.member.role]}?`,
          description:
            next === "owner"
              ? "Owners have full control of this organization, including every member’s role."
              : "They lose full control of this organization.",
          action: next === "owner" ? "Make owner" : "Change role",
          tone: "default",
        }}
        onConfirm={() => (next ? changeRole(props.member, next) : undefined)}
      />
    </>
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
  if (memberships.isPending) return null
  if (names.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <TruncatedText text={names.join(", ")} className="flex items-center gap-1.5 text-muted-foreground">
      <span className="truncate">{names.slice(0, 2).join(", ")}</span>
      {names.length > 2 ? <span className="shrink-0 text-xs text-muted-foreground">+{names.length - 2}</span> : null}
    </TruncatedText>
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

function ClearFilters(props: { message: string; onClear: () => void }) {
  return (
    <span className="flex flex-col items-center gap-2">
      {props.message}
      <Button variant="outline" size="sm" onClick={props.onClear}>
        Clear filters
      </Button>
    </span>
  )
}

function MembersTab(props: {
  query: string
  filters: Filters
  roles: RoleOptions
  myRole: Role | undefined
  onClear: () => void
}) {
  const { auth } = RouterContext.useRouterContext()
  const me = useMe()
  const refresh = useRefresh()
  const canAdminister = useCanAdminister()
  const [adding, setAdding] = useState<{ id: string; name: string }>()
  const rows = useMembers()
    .members.filter((member) => FilterMatch.passes(props.filters, { role: [member.role] }))
    .filter((member) => Search.matches(props.query, member.name, member.email))
    .map((member) => ({ ...member, you: member.id === me.user.id }))
  const shown = useShown(rows)
  const remove = async (memberId: string, name: string) => {
    const result = await auth.organization.removeMember({
      memberIdOrEmail: memberId,
      organizationId: me.organization.id,
    })
    await refresh()
    if (result.error === null) toast.success(`${name} removed from organization`)
    else toast.error("Couldn’t remove member", { description: result.error.message, duration: Infinity })
  }
  return (
    <>
      <MembersTable
        rows={rows}
        limit={shown.items.length}
        column={{
          heading: "Role",
          cell: (row) => (
            <RoleCell
              member={row}
              roles={props.roles}
              editable={canAdminister && !row.you && (row.role !== "owner" || props.myRole === "owner")}
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
                action: "Remove member",
              }
        }
        onRemove={(row) => remove(row.memberId, row.name)}
        empty={
          <ClearFilters message={Search.empty(props.query, "No members match these filters")} onClear={props.onClear} />
        }
      />
      <LoadMore more={shown.more} onMore={shown.next} />
      {adding ? <AddToSpacesDialog key={adding.id} member={adding} onClose={() => setAdding(undefined)} /> : null}
    </>
  )
}

function InvitationsTab(props: { query: string; filters: Filters; onClear: () => void }) {
  const { auth } = RouterContext.useRouterContext()
  const me = useMe()
  const refresh = useRefresh()
  const canAdminister = useCanAdminister()
  const invitations = useOrganization()
    .invitations.filter((invitation) => invitation.status === "pending")
    .filter((invitation) => FilterMatch.passes(props.filters, { role: [invitation.role] }))
    .filter((invitation) => Search.matches(props.query, invitation.email))
  const shown = useShown(invitations)
  const filtered = props.query.trim() !== "" || Object.values(props.filters).some((values) => values.length > 0)
  const resend = async (email: string, role: string) => {
    const result = await auth.organization.inviteMember({
      email,
      role: isRole(role) ? role : "member",
      organizationId: me.organization.id,
      resend: true,
    })
    await refresh()
    if (result.error === null) toast.success(`Invitation resent to ${email}`)
    else toast.error("Couldn’t resend invitation", { description: result.error.message, duration: Infinity })
  }
  const revoke = async (invitationId: string, email: string) => {
    const result = await auth.organization.cancelInvitation({ invitationId })
    await refresh()
    if (result.error === null) toast.success(`Invitation to ${email} revoked`)
    else toast.error("Couldn’t revoke invitation", { description: result.error.message, duration: Infinity })
  }
  return (
    <>
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
            {shown.items.length === 0 ? (
              <TableEmpty columns={4}>
                {filtered ? (
                  <ClearFilters
                    message={Search.empty(props.query, "No invitations match these filters")}
                    onClear={props.onClear}
                  />
                ) : (
                  "No pending invitations"
                )}
              </TableEmpty>
            ) : null}
            {shown.items.map((invite) => (
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
                            title: `Revoke the invitation to ${invite.email}?`,
                            description: "The invitation link stops working. You can invite them again later.",
                            action: "Revoke invitation",
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
      <LoadMore more={shown.more} onMore={shown.next} />
    </>
  )
}

function LinksTab(props: { links: ReadonlyArray<OrganizationInviteLinkInfo>; query: string }) {
  const shown = useShown(
    props.links.filter((link) =>
      Search.matches(props.query, link.createdBy.name, ...link.spaces.map((space) => space.name)),
    ),
  )
  return (
    <>
      <OrganizationInviteLinksTable links={shown.items} empty={Search.empty(props.query, "No invite links yet")} />
      <LoadMore more={shown.more} onMore={shown.next} />
    </>
  )
}

export function MembersSettingsPage() {
  const { api } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const me = useMe()
  const organization = useOrganization()
  const members = useMembers().members
  const canAdminister = useCanAdminister()
  const tab = search.tab ?? "members"
  const [filters, setFilters] = useState<Filters>({})
  const [query, setQuery] = useState("")
  const myRole = members.find((member) => member.id === me.user.id)?.role
  const inviteRoles = roleOptions.filter((option) => option.value !== "owner" || myRole === "owner")
  const links =
    useQuery({ ...api["organization-invite-link"].list.queryOptions(), enabled: canAdminister }).data?.items ?? []
  const noun = { members: "members", invitations: "invitations", links: "invite links" }[tab]
  const clear = () => {
    setFilters({})
    setQuery("")
  }
  return (
    <Page
      title="Members"
      description="Everyone in your organization."
      tabs={
        <Tabs
          value={tab}
          onValueChange={(value: string) =>
            void navigate({ search: { tab: value === "invitations" || value === "links" ? value : "members" } })
          }
        >
          <PageTabsList>
            <PageTabsTrigger value="members" count={members.length}>
              Members
            </PageTabsTrigger>
            <PageTabsTrigger
              value="invitations"
              count={organization.invitations.filter((invitation) => invitation.status === "pending").length}
            >
              Invitations
            </PageTabsTrigger>
            {canAdminister ? (
              <PageTabsTrigger value="links" count={links.length}>
                Invite links
              </PageTabsTrigger>
            ) : null}
          </PageTabsList>
        </Tabs>
      }
      actions={
        <>
          <ToolbarSearch label={`Search ${noun}`} value={query} onChange={setQuery} />
          {tab === "links" ? (
            <OrganizationInviteLinkDialog />
          ) : (
            <>
              <FilterMenu
                label={`Filter ${noun}`}
                properties={[{ key: "role", label: "Role", any: "Any", icon: IconShield, options: roles }]}
                value={filters}
                onChange={setFilters}
              />
              {canAdminister ? <InviteDialog roles={inviteRoles} /> : null}
            </>
          )}
        </>
      }
    >
      {
        {
          members: <MembersTab query={query} filters={filters} roles={inviteRoles} myRole={myRole} onClear={clear} />,
          invitations: <InvitationsTab query={query} filters={filters} onClear={clear} />,
          links: <LinksTab links={links} query={query} />,
        }[tab]
      }
    </Page>
  )
}
