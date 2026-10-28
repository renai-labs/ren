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
import { Icon } from "@ren/ui/icon"
import { Page } from "@ren/ui/page"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Text } from "@ren/ui/text"
import { Initials } from "@ren/util/initials"
import { toast } from "@ren/ui/toast"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { Members } from "./members.js"
import { RoleSelect } from "./role-select.js"
import { SortableHead } from "./table-parts.js"

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
      <Page.TableCard>
        <Table className="table-fixed">
          <TableCaption className="sr-only">Organization members</TableCaption>
          <TableHeader>
            <TableRow className="border-0 hover:bg-transparent">
              <SortableHead direction={direction} onDirectionChange={setDirection}>
                Name
              </SortableHead>
              <TableHead className="hidden w-1/3 px-4 font-normal text-muted-foreground md:table-cell">Email</TableHead>
              <TableHead className="w-36 px-4 font-normal text-muted-foreground">Role</TableHead>
              <TableHead className="w-15" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.state === "ready" && visible.length > 0 ? (
              visible.map((row) => (
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
              ))
            ) : (
              <Page.TableState
                columns={4}
                state={props.state === "ready" ? "empty" : props.state}
                failureMessage={props.failureMessage}
                emptyMessage={query === "" ? "No members yet." : `Nothing matches “${query}”`}
              />
            )}
          </TableBody>
        </Table>
      </Page.TableCard>
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
            toast.add({ type: "success", title: `${removing.name} removed from organization` })
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
      toast.add({ type: "success", title: `${row.name} is now ${role}` })
      return
    }
    toast.add({ type: "error", title: "Couldn’t change role", description: result.error.message })
  }
  return (
    <TableRow className="border-0">
      <TableCell className="px-4 py-3">
        <MemberName row={row} />
      </TableCell>
      <TableCell className="hidden truncate px-4 py-3 md:table-cell">{row.email || "—"}</TableCell>
      <TableCell className="px-4 py-3">
        <RoleSelect
          label={`Role for ${row.name}`}
          value={row.role}
          disabled={row.isSelf}
          onValueChange={(role) => void changeRole(role)}
          size="sm"
          className="w-28 justify-between border-transparent bg-muted px-2 text-xs"
        />
      </TableCell>
      <TableCell className="px-4 py-3">
        {row.isSelf ? null : (
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
        )}
      </TableCell>
    </TableRow>
  )
}

function MemberName(props: { row: Members.MemberRow }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar size="sm" aria-hidden>
        {props.row.image ? <AvatarImage src={props.row.image} alt="" /> : null}
        <AvatarFallback>{Initials.of(props.row.name)}</AvatarFallback>
      </Avatar>
      <Text truncation="single-line" element="span" title={props.row.name}>
        {props.row.name}
      </Text>
      {props.row.isSelf ? (
        <span className="shrink-0">
          <Text purpose="caption" element="span">
            You
          </Text>
        </span>
      ) : null}
    </span>
  )
}
