import { Button } from "@ren/ui/button"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Icon } from "@ren/ui/icon"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Text } from "@ren/ui/text"
import { Time } from "@ren/ui/time"
import { toast } from "@ren/ui/toast"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { Platform } from "../../platform/platform.js"
import { Members } from "./members.js"
import { SortableHead, StateRow } from "./table-parts.js"

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
      <div className="rounded-xl border bg-card p-2">
        <Table className="table-fixed">
          <TableCaption className="sr-only">Invitations</TableCaption>
          <TableHeader>
            <TableRow className="border-0 hover:bg-transparent">
              <SortableHead direction={direction} onDirectionChange={setDirection}>
                Email
              </SortableHead>
              <TableHead className="w-1/4 px-4 font-normal text-muted-foreground">Status</TableHead>
              <TableHead className="w-28 px-4 font-normal text-muted-foreground">Role</TableHead>
              <TableHead className="w-15" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.state === "ready" && visible.length > 0 ? (
              visible.map((row) => (
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
              ))
            ) : (
              <StateRow
                columns={4}
                state={props.state}
                failureMessage={props.failureMessage}
                emptyMessage={query === "" ? "No pending invitations." : `Nothing matches “${query}”`}
                emptyGlyph="Mail"
              />
            )}
          </TableBody>
        </Table>
      </div>
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
          if (revoking !== undefined) toast.add({ type: "success", title: `Invitation to ${revoking.email} revoked` })
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
      toast.add({ type: "success", title: `Invitation resent to ${row.email}` })
      return
    }
    toast.add({ type: "error", title: "Couldn’t resend invitation", description: result.error.message })
  }
  return (
    <TableRow className="border-0">
      <TableCell className="px-4 py-3">
        <Text element="span" truncation="single-line" leadingIcon={<Icon glyph="Mail" tone="secondary" />}>
          {row.email}
        </Text>
      </TableCell>
      <TableCell className="px-4 py-3">
        <Text element="span" tone={row.isExpired ? "danger" : "primary"} truncation="single-line">
          {row.isExpired ? "Expired " : "Expires "}
          <Time value={row.expiresAt} format="relative" relativeStyle="narrow" />
        </Text>
      </TableCell>
      <TableCell className="px-4 py-3">
        <Text element="span" letterCase="capitalized">
          {row.role}
        </Text>
      </TableCell>
      <TableCell className="px-4 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="-my-1 flex text-muted-foreground"
                aria-label="Invitation actions"
              />
            }
          >
            <Icon glyph="MoreHorizontal" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  void platform.writeClipboardText?.(`${platform.appUrl}/signup?invitationId=${row.id}`)
                  toast.add({ type: "success", title: "Invite link copied" })
                }}
              >
                <Icon glyph="Link" />
                Copy invite link
              </DropdownMenuItem>
              <DropdownMenuItem disabled={resending} onClick={() => void resend()}>
                <Icon glyph="RefreshCw" />
                Resend
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onClick={props.onRevoke}>
                <Icon glyph="Trash2" />
                Revoke
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}
