import { useState, type ReactNode } from "react"
import type { CredentialInfo } from "@ren/client"
import { useMutation } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Field, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Spinner } from "@ren/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { RowMenu } from "./row-menu.js"
import { StatusBadge } from "./status-badge.js"
import { TableCard, TableEmpty } from "./page.js"
import { ownerInput, ownerOptions } from "./credential-sheet.js"
import { useMe } from "../lib/use-me.js"
import { useSpaces } from "../lib/use-spaces.js"
import { errorMessage } from "../lib/errors.js"
import { anyHost, canCopy, hostsLabel, ownerLabel } from "../lib/apps.js"
import { cn } from "cn"
import { RouterContext } from "../lib/router-context.js"

type Credential = CredentialInfo

type Editing = { readonly kind: "rotate" | "move" | "copy"; readonly credential: Credential }

function RotateDialog(props: { credential: Credential; onClose: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const rotate = useMutation(api.credential.rotate.mutationOptions())
  const [value, setValue] = useState("")
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            if (!value.trim()) return
            rotate.mutate(
              { id: props.credential.id, value: { type: "key", value: value.trim() } },
              {
                onSuccess: () => {
                  toast.success(`${props.credential.label} rotated`)
                  props.onClose()
                },
                onError: (error) => toast.error("Could not rotate the key", { description: errorMessage(error) }),
              },
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>Rotate {props.credential.label}</DialogTitle>
            <DialogDescription>Paste the new key. Chats use it from their next request.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="rotate-key">New key</FieldLabel>
            <Input
              id="rotate-key"
              type="password"
              autoComplete="off"
              className="font-mono"
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={rotate.isPending}>
              {rotate.isPending ? <Spinner data-icon="inline-start" /> : null}
              Rotate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function OwnerDialog(props: { kind: "move" | "copy"; credential: Credential; onClose: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const me = useMe()
  const spaces = useSpaces().spaces
  const owners = ownerOptions(spaces)
  const [owner, setOwner] = useState(owners.at(0)?.value ?? "org")
  const move = useMutation(api.credential.move.mutationOptions())
  const copy = useMutation(api.credential.copy.mutationOptions())
  const pending = move.isPending || copy.isPending
  const verb = props.kind === "move" ? "Move" : "Copy"
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {verb} {props.credential.label}
          </DialogTitle>
          <DialogDescription>
            {props.kind === "move"
              ? "Choose who can use it from now on."
              : "A copy is a separate pasted key with its own owner."}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel>Who can use it</FieldLabel>
          <Select items={owners} value={owner} onValueChange={(value) => setOwner(String(value))}>
            <SelectTrigger aria-label="Who can use it" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {owners.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              const input = { id: props.credential.id, owner: ownerInput(owner, me.user.id) }
              const done = {
                onSuccess: () => {
                  toast.success(`${props.credential.label} ${props.kind === "move" ? "moved" : "copied"}`)
                  props.onClose()
                },
                onError: (error: Error) =>
                  toast.error(`Could not ${props.kind} the key`, { description: errorMessage(error) }),
              }
              if (props.kind === "move") move.mutate(input, done)
              else copy.mutate(input, done)
            }}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CredentialsTable(props: {
  credentials: ReadonlyArray<Credential>
  empty: ReactNode
  stale?: boolean | undefined
  onRemoved?: (() => void) | undefined
}) {
  const { api } = RouterContext.useRouterContext()
  const me = useMe()
  const spaces = useSpaces().spaces
  const remove = useMutation(api.credential.remove.mutationOptions())
  const [editing, setEditing] = useState<Editing>()
  return (
    <TableCard className={cn("transition-opacity", props.stale && "opacity-60")}>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead className="w-1/3">Hosts</TableHead>
            <TableHead className="w-1/4">Owner</TableHead>
            <TableHead className="w-15" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.credentials.length === 0 ? <TableEmpty columns={5}>{props.empty}</TableEmpty> : null}
          {props.credentials.map((credential) => {
            const detail = [
              credential.name ? credential.label : undefined,
              credential.keyPreview ? `…${credential.keyPreview}` : undefined,
            ].filter(Boolean)
            return (
              <TableRow key={credential.id}>
                <TableCell>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate" title={credential.label}>
                      {credential.name ?? credential.label}
                    </span>
                    {detail.length ? (
                      <span className="truncate font-mono text-xs text-muted-foreground">{detail.join(" · ")}</span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="truncate text-muted-foreground" title={credential.hosts.join(", ")}>
                  {hostsLabel(credential.hosts)}
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-2">
                    {ownerLabel(credential.owner, spaces, me.user.id)}
                    {credential.account ? (
                      <StatusBadge tone="neutral">{credential.account.name}’s account</StatusBadge>
                    ) : null}
                    {credential.delivery === "delivered" ? <StatusBadge tone="warn">Delivered</StatusBadge> : null}
                    {credential.status === "reconnect" ? <StatusBadge tone="error">Reconnect</StatusBadge> : null}
                  </span>
                </TableCell>
                <TableCell>
                  <RowMenu
                    label={`${credential.label} actions`}
                    items={[
                      ...(canCopy(credential)
                        ? [{ label: "Rotate", onSelect: () => setEditing({ kind: "rotate", credential }) }]
                        : []),
                      { label: "Move", onSelect: () => setEditing({ kind: "move", credential }) },
                      ...(canCopy(credential)
                        ? [{ label: "Copy", onSelect: () => setEditing({ kind: "copy", credential }) }]
                        : []),
                      {
                        label: "Delete",
                        onSelect: () =>
                          remove.mutateAsync(
                            { id: credential.id },
                            {
                              onSuccess: () => {
                                toast.success(`${credential.label} deleted`)
                                props.onRemoved?.()
                              },
                              onError: (error) =>
                                toast.error("Could not delete the key", { description: errorMessage(error) }),
                            },
                          ),
                        confirm: {
                          title: `Delete ${credential.label}?`,
                          description: `Chats that use ${credential.label} lose it at once: their next request to ${credential.hosts.includes(anyHost) ? "any website" : credential.hosts.join(", ")} gets no key.`,
                          action: "Delete",
                        },
                      },
                    ]}
                  />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {editing?.kind === "rotate" ? (
        <RotateDialog credential={editing.credential} onClose={() => setEditing(undefined)} />
      ) : null}
      {editing && editing.kind !== "rotate" ? (
        <OwnerDialog kind={editing.kind} credential={editing.credential} onClose={() => setEditing(undefined)} />
      ) : null}
    </TableCard>
  )
}
