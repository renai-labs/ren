import type { CredentialInfo } from "@ren/client"
import { Badge } from "@ren/ui/badge"
import { Icon } from "@ren/ui/icon"
import type { Owners } from "./owners.js"
import { Menu } from "@ren/ui/menu"
import { Table } from "@ren/ui/table"
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
  onChanged: () => Promise<unknown>
}) {
  const [editing, setEditing] = useState<Editing>()
  const [deleting, setDeleting] = useState<CredentialInfo>()
  const [confirming, setConfirming] = useState(false)
  const close = () => setEditing(undefined)
  return (
    <>
      <Table.Root
        state={props.state}
        failureMessage="Couldn’t load credentials."
        emptyMessage={props.query ? `Nothing matches “${props.query}”` : props.emptyMessage}
        caption="Credentials"
      >
        <Table.Header>
          <Table.HeaderCell width="fill">Credential</Table.HeaderCell>
          <Table.HeaderCell width="third" visibility="wide-screens">
            Hosts
          </Table.HeaderCell>
          <Table.HeaderCell width="quarter">Owner</Table.HeaderCell>
          <Table.RowActionsHeaderCell />
        </Table.Header>
        <Table.Body>
          {props.rows.map((row) => (
            <Table.Row key={row.id}>
              <Table.Cell>
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
              </Table.Cell>
              <Table.Cell visibility="wide-screens">
                <Text truncation="single-line" element="span" title={row.hosts.join(", ")}>
                  {row.hosts.join(", ")}
                </Text>
              </Table.Cell>
              <Table.Cell>
                <span className="flex items-center gap-2">
                  <Text element="span">{Credentials.ownerLabel(row.owner, props.spaces, props.userId)}</Text>
                  {row.account ? <Badge tone="neutral">{`${row.account.name}’s account`}</Badge> : null}
                  {row.delivery === "delivered" ? <Badge tone="warning">Delivered</Badge> : null}
                  {row.status === "reconnect" ? <Badge tone="danger">Reconnect</Badge> : null}
                </span>
              </Table.Cell>
              <Table.RowActions label={`${row.label} actions`}>
                {Credentials.canCopy(row) ? (
                  <Menu.Item
                    icon={<Icon glyph="RefreshCw" />}
                    onSelect={() => setEditing({ kind: "rotate", credential: row })}
                  >
                    Rotate
                  </Menu.Item>
                ) : null}
                <Menu.Item
                  icon={<Icon glyph="ArrowRight" />}
                  onSelect={() => setEditing({ kind: "move", credential: row })}
                >
                  Move
                </Menu.Item>
                {Credentials.canCopy(row) ? (
                  <Menu.Item
                    icon={<Icon glyph="Copy" />}
                    onSelect={() => setEditing({ kind: "copy", credential: row })}
                  >
                    Copy
                  </Menu.Item>
                ) : null}
                <Menu.Item
                  tone="danger"
                  icon={<Icon glyph="Trash2" />}
                  onSelect={() => {
                    setDeleting(row)
                    setConfirming(true)
                  }}
                >
                  Delete
                </Menu.Item>
              </Table.RowActions>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
      {editing?.kind === "rotate" ? (
        <RotateCredentialDialog credential={editing.credential} onClose={close} onSaved={props.onChanged} />
      ) : null}
      {editing?.kind === "move" || editing?.kind === "copy" ? (
        <MoveCredentialDialog
          credential={editing.credential}
          action={editing.kind}
          owners={props.owners}
          userId={props.userId}
          onClose={close}
          onSaved={props.onChanged}
        />
      ) : null}
      <DeleteCredentialDialog
        credential={deleting}
        open={confirming}
        onOpenChange={setConfirming}
        onDeleted={props.onChanged}
      />
    </>
  )
}
