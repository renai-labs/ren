import { Avatar } from "@ren/ui/avatar"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { Icon } from "@ren/ui/icon"
import { Menu } from "@ren/ui/menu"
import { Select } from "@ren/ui/select"
import { Table } from "@ren/ui/table"
import { Text } from "@ren/ui/text"
import { Toast } from "@ren/ui/toast"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { Members } from "./members.js"

export function MembersTable(props: {
  rows: ReadonlyArray<Members.MemberRow>
  query: string
  state: "loading" | "failed" | "ready"
  failureMessage: string
  organizationId: string
  onChanged: () => Promise<void>
}) {
  const context = RouterContext.useRouterContext()
  const [direction, setDirection] = useState<"ascending" | "descending">("ascending")
  const [removing, setRemoving] = useState<Members.MemberRow>()
  const [confirming, setConfirming] = useState(false)
  const visible = Members.sortBy(
    Members.search(props.rows, props.query, (row) => [row.name, row.email, row.role]),
    (row) => row.name,
    direction,
  )
  const query = props.query.trim()
  return (
    <>
      <Table.Root
        state={props.state === "ready" && visible.length === 0 ? "empty" : props.state}
        failureMessage={props.failureMessage}
        emptyMessage={query === "" ? "No members yet." : `Nothing matches “${query}”`}
        caption="Organization members"
      >
        <Table.Header>
          <Table.SortableHeaderCell direction={direction} onSortChange={setDirection}>
            Name
          </Table.SortableHeaderCell>
          <Table.HeaderCell width="third" visibility="wide-screens">
            Email
          </Table.HeaderCell>
          <Table.HeaderCell width="medium">Role</Table.HeaderCell>
          <Table.RowActionsHeaderCell />
        </Table.Header>
        <Table.Body>
          {visible.map((row) => (
            <MemberRow
              key={row.id}
              row={row}
              organizationId={props.organizationId}
              onChanged={props.onChanged}
              onRemove={() => {
                setRemoving(row)
                setConfirming(true)
              }}
            />
          ))}
        </Table.Body>
      </Table.Root>
      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={removing === undefined ? "Remove member?" : `Remove ${removing.name}?`}
        description="They lose access to this organization and all of its teams."
        confirmLabel="Remove"
        tone="danger"
        onConfirm={async () => {
          if (removing === undefined) return
          const result = await context.auth.organization.removeMember({
            memberIdOrEmail: removing.id,
            organizationId: props.organizationId,
          })
          await props.onChanged()
          if (result.error !== null) throw new Error(result.error.message ?? "Couldn’t remove member")
        }}
        onConfirmed={() => {
          if (removing !== undefined) {
            Toast.manager.add({ type: "success", title: `${removing.name} removed from organization` })
          }
        }}
      />
    </>
  )
}

function MemberRow(props: {
  row: Members.MemberRow
  organizationId: string
  onChanged: () => Promise<void>
  onRemove: () => void
}) {
  const context = RouterContext.useRouterContext()
  const row = props.row
  const changeRole = async (role: Members.Role) => {
    if (role === row.role) return
    const result = await context.auth.organization.updateMemberRole({
      memberId: row.id,
      role,
      organizationId: props.organizationId,
    })
    await props.onChanged()
    if (result.error === null) {
      Toast.manager.add({ type: "success", title: `${row.name} is now ${role}` })
      return
    }
    Toast.manager.add({ type: "error", title: "Couldn’t change role", description: result.error.message })
  }
  return (
    <Table.Row>
      <Table.Cell>
        <MemberName row={row} />
      </Table.Cell>
      <Table.Cell visibility="wide-screens">{row.email || "—"}</Table.Cell>
      <Table.Cell>
        <Select.Root
          value={row.role}
          disabled={row.isSelf}
          onValueChange={(role) => void changeRole(role)}
          label={`Role for ${row.name}`}
          appearance="filled"
          size="small"
          width="full"
          options={Members.roleOptions}
        />
      </Table.Cell>
      <Table.RowActions label="Member actions">
        {row.isSelf ? null : (
          <Menu.Item tone="danger" icon={<Icon glyph="Trash2" />} onSelect={props.onRemove}>
            Remove
          </Menu.Item>
        )}
      </Table.RowActions>
    </Table.Row>
  )
}

function MemberName(props: { row: Members.MemberRow }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar.Root name={props.row.name} image={props.row.image} size="small" decorative />
      <span className="flex min-w-0 flex-col">
        <Text truncation="single-line" element="span" title={props.row.name}>
          {props.row.name}
        </Text>
        {props.row.isSelf ? (
          <Text purpose="caption" element="span">
            You
          </Text>
        ) : null}
      </span>
    </span>
  )
}
