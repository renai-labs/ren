import { Pagination } from "@ren/schema/pagination"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@ren/ui/empty"
import { Icon } from "@ren/ui/icon"
import { SearchField } from "@ren/ui/search-field"
import { Spinner } from "@ren/ui/spinner"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Text } from "@ren/ui/text"
import { toast } from "@ren/ui/toast"
import { Toolbar } from "@ren/ui/toolbar"
import { Initials } from "@ren/util/initials"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useDeferredValue, useState } from "react"
import { Search } from "@ren/util/search"
import { RouterContext } from "../../lib/router-context.js"
import { AddSpaceMemberDialog } from "./add-space-member-dialog.js"
import { Spaces } from "./spaces.js"

export function SpaceMembers(props: { spaceId: string; organizationId: string; userId: string }) {
  const context = RouterContext.useRouterContext()
  const space = useQuery(context.api.space.get.queryOptions({ idOrSlug: props.spaceId }))
  const members = useQuery(
    context.api["space-member"].list.queryOptions({
      spaceId: props.spaceId,
      page: 1,
      pageSize: Pagination.maximumPageSize,
    }),
  )
  const [query, setQuery] = useState("")
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Spaces.MemberRow>()
  const [confirming, setConfirming] = useState(false)
  const needle = useDeferredValue(query)
  const items = members.data?.items ?? []
  const canAddMember = space.data?.canAddMember ?? false
  const canRemoveMember = space.data?.canRemoveMember ?? false
  const visible = Spaces.memberRows(items, props.userId).filter((row) => Search.matches([row.name, row.email], needle))
  const state = { pending: "loading", error: "failed", success: visible.length > 0 ? "ready" : "empty" } as const
  return (
    <>
      <Toolbar.Root>
        <SearchField.Expandable value={query} onValueChange={setQuery} placeholder="Search members" />
        {canAddMember ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Icon glyph="Plus" data-icon="inline-start" />
            Add member
          </Button>
        ) : null}
      </Toolbar.Root>
      <MembersTable
        rows={visible}
        state={state[members.status]}
        query={needle.trim()}
        onRemove={
          canRemoveMember
            ? (row) => {
                setRemoving(row)
                setConfirming(true)
              }
            : undefined
        }
      />
      {adding ? (
        <AddSpaceMemberDialog
          spaceId={props.spaceId}
          organizationId={props.organizationId}
          members={items}
          onClose={() => setAdding(false)}
        />
      ) : null}
      <RemoveMemberDialog member={removing} open={confirming} onOpenChange={setConfirming} />
    </>
  )
}

function RemoveMemberDialog(props: {
  member: Spaces.MemberRow | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const context = RouterContext.useRouterContext()
  const remove = useMutation(context.api["space-member"].archive.mutationOptions())
  const name = props.member?.name ?? "member"
  return (
    <ConfirmationDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={`Remove ${name}?`}
      description={
        props.member?.status === "pending"
          ? "They will not join this space when they accept their invite."
          : "They keep their organization account but lose access to this space."
      }
      confirmLabel="Remove"
      tone="danger"
      onConfirm={async () => {
        if (!props.member) return
        await remove.mutateAsync({ id: props.member.id })
      }}
      onConfirmed={() => toast.add({ type: "success", title: `${props.member?.name ?? "Member"} removed` })}
    />
  )
}

function MembersTable(props: {
  rows: ReadonlyArray<Spaces.MemberRow>
  state: "loading" | "failed" | "ready" | "empty"
  query: string
  onRemove: ((row: Spaces.MemberRow) => void) | undefined
}) {
  return (
    <div className="rounded-xl border bg-card p-2 [&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-3 [&_th]:font-normal [&_th]:text-muted-foreground [&_tr]:border-0">
      <Table className="table-fixed">
        <TableCaption className="sr-only">Space members</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden w-1/3 md:table-cell">Email</TableHead>
            {props.onRemove ? (
              <TableHead className="w-15">
                <span className="sr-only">Actions</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.state === "ready" ? null : (
            <StateRow
              state={props.state}
              emptyMessage={
                props.query ? `Nothing matches “${props.query}”` : "No members yet. Add one to get started."
              }
            />
          )}
          {props.rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <MemberName row={row} />
              </TableCell>
              <TableCell className="hidden truncate md:table-cell">{row.email || "—"}</TableCell>
              {props.onRemove ? (
                <TableCell>
                  <MemberActions onRemove={() => props.onRemove?.(row)} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function StateRow(props: { state: "loading" | "failed" | "empty"; emptyMessage: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={3}>
        {props.state === "loading" ? <Spinner className="mx-auto" /> : null}
        {props.state === "failed" ? (
          <Empty role="alert">
            <EmptyHeader>
              <EmptyTitle>Couldn’t load members.</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : null}
        {props.state === "empty" ? (
          <Empty>
            <EmptyHeader>
              <EmptyDescription>{props.emptyMessage}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </TableCell>
    </TableRow>
  )
}

function MemberActions(props: { onRemove: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="-my-1 flex text-muted-foreground"
            aria-label="Member actions"
          />
        }
      >
        <Icon glyph="MoreHorizontal" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" onClick={props.onRemove}>
            <Icon glyph="Trash2" />
            Remove
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MemberName(props: { row: Spaces.MemberRow }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar size="sm" aria-hidden>
        {props.row.image ? <AvatarImage src={props.row.image} alt="" /> : null}
        <AvatarFallback>{Initials.of(props.row.name)}</AvatarFallback>
      </Avatar>
      <Text truncation="single-line" element="span" title={props.row.name}>
        {props.row.name}
      </Text>
      {props.row.tag ? (
        <span className="shrink-0">
          <Text purpose="caption" element="span">
            {props.row.tag}
          </Text>
        </span>
      ) : null}
    </span>
  )
}
