import { Pagination } from "@ren/schema/pagination"
import { Avatar } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { Icon } from "@ren/ui/icon"
import { Menu } from "@ren/ui/menu"
import { SearchField } from "@ren/ui/search-field"
import { Table } from "@ren/ui/table"
import { Text } from "@ren/ui/text"
import { Toast } from "@ren/ui/toast"
import { Toolbar } from "@ren/ui/toolbar"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useDeferredValue, useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { AddSpaceMemberDialog } from "./add-space-member-dialog.js"
import { Spaces } from "./spaces.js"

export function SpaceMembers(props: { spaceId: string; organizationId: string; userId: string }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
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
  const visible = Spaces.memberRows(items, props.userId).filter((row) => Spaces.matches([row.name, row.email], needle))
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: context.api["space-member"].list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: context.api.space.get.queryKey() }),
      queryClient.invalidateQueries({ queryKey: context.api.space.list.queryKey() }),
    ])
  const state = { pending: "loading", error: "failed", success: visible.length > 0 ? "ready" : "empty" } as const
  return (
    <>
      <Toolbar.Root>
        <SearchField.Expandable value={query} onValueChange={setQuery} placeholder="Search members" />
        {canAddMember ? (
          <Button appearance="primary" size="small" leadingIcon={<Icon glyph="Plus" />} onClick={() => setAdding(true)}>
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
          onChanged={refresh}
        />
      ) : null}
      <RemoveMemberDialog member={removing} open={confirming} onOpenChange={setConfirming} onRemoved={refresh} />
    </>
  )
}

function RemoveMemberDialog(props: {
  member: Spaces.MemberRow | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  onRemoved: () => Promise<unknown>
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
        await props.onRemoved()
      }}
      onConfirmed={() => Toast.manager.add({ type: "success", title: `${props.member?.name ?? "Member"} removed` })}
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
    <Table.Root
      state={props.state}
      failureMessage="Couldn’t load members."
      emptyMessage={props.query ? `Nothing matches “${props.query}”` : "No members yet. Add one to get started."}
      caption="Space members"
    >
      <Table.Header>
        <Table.HeaderCell width="fill">Name</Table.HeaderCell>
        <Table.HeaderCell width="third" visibility="wide-screens">
          Email
        </Table.HeaderCell>
        {props.onRemove ? <Table.RowActionsHeaderCell /> : null}
      </Table.Header>
      <Table.Body>
        {props.rows.map((row) => (
          <Table.Row key={row.id}>
            <Table.Cell>
              <MemberName row={row} />
            </Table.Cell>
            <Table.Cell visibility="wide-screens">{row.email || "—"}</Table.Cell>
            {props.onRemove ? (
              <Table.RowActions label="Member actions">
                <Menu.Item tone="danger" icon={<Icon glyph="Trash2" />} onSelect={() => props.onRemove?.(row)}>
                  Remove
                </Menu.Item>
              </Table.RowActions>
            ) : null}
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  )
}

function MemberName(props: { row: Spaces.MemberRow }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar.Root name={props.row.name} image={props.row.image} size="small" decorative />
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
