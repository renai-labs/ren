import type { CredentialInfo } from "@ren/client"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Page } from "@ren/ui/page"
import { Icon } from "@ren/ui/icon"
import type { Owners } from "./owners.js"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Text } from "@ren/ui/text"
import { useState } from "react"
import { DeleteCredentialDialog, MoveCredentialDialog, RotateCredentialDialog } from "./credential-dialogs.js"
import { Credentials } from "../../components/credentials.js"

type Editing = { readonly kind: "rotate" | "move" | "copy"; readonly credential: CredentialInfo } | undefined

export function CredentialsTable(props: {
  rows: ReadonlyArray<CredentialInfo>
  state: "loading" | "failed" | "ready" | "empty"
  query: string
  spaces: ReadonlyMap<string, string>
  owners: ReadonlyArray<Owners.Option>
  userId: string
  emptyMessage: string
}) {
  const [editing, setEditing] = useState<Editing>()
  const [deleting, setDeleting] = useState<CredentialInfo>()
  const [confirming, setConfirming] = useState(false)
  const close = () => setEditing(undefined)
  return (
    <>
      <Page.TableCard>
        <Table className="table-fixed">
          <TableCaption className="sr-only">Credentials</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Credential</TableHead>
              <TableHead className="hidden w-1/3 md:table-cell">Hosts</TableHead>
              <TableHead className="w-1/4">Owner</TableHead>
              <TableHead className="w-15">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <Page.TableState
              state={props.state}
              columns={4}
              failureMessage="Couldn’t load credentials."
              emptyMessage={props.query ? `Nothing matches “${props.query}”` : props.emptyMessage}
            />
            {props.rows.map((row) => (
              <CredentialRow
                key={row.id}
                row={row}
                owner={Credentials.ownerLabel(row.owner, props.spaces, props.userId)}
                onEdit={(kind) => setEditing({ kind, credential: row })}
                onDelete={() => {
                  setDeleting(row)
                  setConfirming(true)
                }}
              />
            ))}
          </TableBody>
        </Table>
      </Page.TableCard>
      {editing?.kind === "rotate" ? <RotateCredentialDialog credential={editing.credential} onClose={close} /> : null}
      {editing?.kind === "move" || editing?.kind === "copy" ? (
        <MoveCredentialDialog
          credential={editing.credential}
          action={editing.kind}
          owners={props.owners}
          userId={props.userId}
          onClose={close}
        />
      ) : null}
      <DeleteCredentialDialog credential={deleting} open={confirming} onOpenChange={setConfirming} />
    </>
  )
}

function CredentialRow(props: {
  row: CredentialInfo
  owner: string
  onEdit: (kind: "rotate" | "move" | "copy") => void
  onDelete: () => void
}) {
  const row = props.row
  return (
    <TableRow>
      <TableCell>
        <span className="flex min-w-0 flex-col">
          <Text truncation="single-line" element="span" title={row.label}>
            {row.name ?? row.label}
          </Text>
          <Text purpose="caption" element="span">
            {[row.name ? row.label : undefined, row.keyPreview ? `…${row.keyPreview}` : undefined]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <Text truncation="single-line" element="span" title={row.hosts.join(", ")}>
          {row.hosts.join(", ")}
        </Text>
      </TableCell>
      <TableCell>
        <span className="flex min-w-0 items-center gap-2">
          <Text truncation="single-line" element="span">
            {props.owner}
          </Text>
          {row.account ? <Badge variant="secondary">{`${row.account.name}’s account`}</Badge> : null}
          {row.delivery === "delivered" ? (
            <Badge variant="secondary" className="bg-status-warning/10 text-status-warning">
              Delivered
            </Badge>
          ) : null}
          {row.status === "reconnect" ? <Badge variant="destructive">Reconnect</Badge> : null}
        </span>
      </TableCell>
      <TableCell>
        <CredentialActions row={row} onEdit={props.onEdit} onDelete={props.onDelete} />
      </TableCell>
    </TableRow>
  )
}

function CredentialActions(props: {
  row: CredentialInfo
  onEdit: (kind: "rotate" | "move" | "copy") => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="-my-1 flex text-muted-foreground"
            aria-label={`${props.row.label} actions`}
          />
        }
      >
        <Icon glyph="MoreHorizontal" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuGroup>
          {Credentials.canCopy(props.row) ? (
            <DropdownMenuItem onClick={() => props.onEdit("rotate")}>
              <Icon glyph="RefreshCw" />
              Rotate
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => props.onEdit("move")}>
            <Icon glyph="ArrowRight" />
            Move
          </DropdownMenuItem>
          {Credentials.canCopy(props.row) ? (
            <DropdownMenuItem onClick={() => props.onEdit("copy")}>
              <Icon glyph="Copy" />
              Copy
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem variant="destructive" onClick={props.onDelete}>
            <Icon glyph="Trash2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
