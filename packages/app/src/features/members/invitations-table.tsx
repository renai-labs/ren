import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { Icon } from "@ren/ui/icon"
import { Menu } from "@ren/ui/menu"
import { Table } from "@ren/ui/table"
import { Text } from "@ren/ui/text"
import { Time } from "@ren/ui/time"
import { Toast } from "@ren/ui/toast"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"
import { Members } from "./members.js"

export function InvitationsTable(props: {
  rows: ReadonlyArray<Members.InvitationRow>
  query: string
  state: "loading" | "failed" | "ready"
  failureMessage: string
  organizationId: string
  onChanged: () => Promise<void>
}) {
  const context = RouterContext.useRouterContext()
  const [direction, setDirection] = useState<"ascending" | "descending">("ascending")
  const [revoking, setRevoking] = useState<Members.InvitationRow>()
  const [confirming, setConfirming] = useState(false)
  const visible = Members.sortBy(
    Members.search(props.rows, props.query, (row) => [row.email, row.role]),
    (row) => row.email,
    direction,
  )
  const query = props.query.trim()
  return (
    <>
      <Table.Root
        state={props.state === "ready" && visible.length === 0 ? "empty" : props.state}
        failureMessage={props.failureMessage}
        emptyIcon={<Icon glyph="Mail" size="medium" tone="secondary" />}
        emptyMessage={query === "" ? "No pending invitations." : `Nothing matches “${query}”`}
        caption="Invitations"
      >
        <Table.Header>
          <Table.SortableHeaderCell direction={direction} onSortChange={setDirection}>
            Email
          </Table.SortableHeaderCell>
          <Table.HeaderCell width="medium">Status</Table.HeaderCell>
          <Table.HeaderCell width="small">Role</Table.HeaderCell>
          <Table.RowActionsHeaderCell />
        </Table.Header>
        <Table.Body>
          {visible.map((row) => (
            <InvitationRow
              key={row.id}
              row={row}
              organizationId={props.organizationId}
              onChanged={props.onChanged}
              onRevoke={() => {
                setRevoking(row)
                setConfirming(true)
              }}
            />
          ))}
        </Table.Body>
      </Table.Root>
      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Revoke invitation?"
        description={`${revoking?.email ?? ""} will no longer be able to join with this link.`}
        confirmLabel="Revoke"
        tone="danger"
        onConfirm={async () => {
          if (revoking === undefined) return
          const result = await context.auth.organization.cancelInvitation({ invitationId: revoking.id })
          await props.onChanged()
          if (result.error !== null) throw new Error(result.error.message ?? "Couldn’t revoke invitation")
        }}
        onConfirmed={() => {
          if (revoking !== undefined)
            Toast.manager.add({ type: "success", title: `Invitation to ${revoking.email} revoked` })
        }}
      />
    </>
  )
}

function InvitationRow(props: {
  row: Members.InvitationRow
  organizationId: string
  onChanged: () => Promise<void>
  onRevoke: () => void
}) {
  const context = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const [resending, setResending] = useState(false)
  const row = props.row
  const resend = async () => {
    setResending(true)
    const result = await context.auth.organization.inviteMember({
      email: row.email,
      role: Members.roleOptions.find((option) => option.value === row.role)?.value ?? "member",
      organizationId: props.organizationId,
      resend: true,
    })
    await props.onChanged()
    setResending(false)
    if (result.error === null) {
      Toast.manager.add({ type: "success", title: `Invitation resent to ${row.email}` })
      return
    }
    Toast.manager.add({ type: "error", title: "Couldn’t resend invitation", description: result.error.message })
  }
  return (
    <Table.Row>
      <Table.Cell>
        <Text element="span" truncation="single-line" leadingIcon={<Icon glyph="Mail" tone="secondary" />}>
          {row.email}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text element="span" tone={row.isExpired ? "danger" : "primary"}>
          {row.isExpired ? "Expired " : "Expires "}
          <Time value={row.expiresAt} format="relative" relativeStyle="narrow" />
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text element="span" letterCase="capitalized">
          {row.role}
        </Text>
      </Table.Cell>
      <Table.RowActions label="Invitation actions">
        <Menu.Item
          icon={<Icon glyph="Link" />}
          onSelect={() => {
            void platform.writeClipboardText?.(`${platform.serverUrl}/signup?invitationId=${row.id}`)
            Toast.manager.add({ type: "success", title: "Invite link copied" })
          }}
        >
          Copy invite link
        </Menu.Item>
        <Menu.Item icon={<Icon glyph="RefreshCw" />} disabled={resending} onSelect={() => void resend()}>
          Resend
        </Menu.Item>
        <Menu.Item tone="danger" icon={<Icon glyph="Trash2" />} onSelect={props.onRevoke}>
          Revoke
        </Menu.Item>
      </Table.RowActions>
    </Table.Row>
  )
}
