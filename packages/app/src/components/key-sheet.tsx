import { useState, type ReactNode } from "react"
import type { CredentialInfo } from "@ren/client"
import { Credential } from "@ren/schema/credential"
import { useMutation } from "@tanstack/react-query"
import { IconKey, IconTrash } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@ren/ui/sheet"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { Switch } from "@ren/ui/switch"
import { formatDate } from "@ren/ui/time"
import { ConfirmDialog } from "./confirm-dialog.js"
import { ownerInput, ownerOptions } from "./credential-sheet.js"
import { anyHost, canCopy } from "../lib/apps.js"
import { errorMessage } from "../lib/errors.js"
import { useMe } from "../lib/use-me.js"
import { useSpaces } from "../lib/use-spaces.js"
import { RouterContext } from "../lib/router-context.js"

type Key = CredentialInfo

const ownerValue = (owner: Key["owner"], userId: string) => {
  if (owner.kind === "space") return `space:${owner.spaceId}`
  if (owner.kind === "person") return owner.userId === userId ? "person" : ""
  return owner.kind === "org" ? "org" : ""
}

const typeLabels: Record<Key["type"], string> = {
  key: "API key",
  basic: "Username and password",
  oauth: "Sign-in",
  fields: "Fields",
  route: "Route",
  client_credentials: "Client credentials",
}

function Detail(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className="min-w-0 truncate text-right">{props.children}</dd>
    </div>
  )
}

function useSave(key: Key, onDone: () => void) {
  const { api } = RouterContext.useRouterContext()
  const update = useMutation(api.credential.update.mutationOptions())
  const move = useMutation(api.credential.move.mutationOptions())
  const rotate = useMutation(api.credential.rotate.mutationOptions())
  const me = useMe()
  return {
    pending: update.isPending || move.isPending || rotate.isPending,
    save: async (input: { name: string; hosts: ReadonlyArray<string>; owner: string; value: string }) => {
      const name = input.name.trim() || null
      const hostsChanged = input.hosts.join(",") !== key.hosts.join(",")
      if (name !== key.name || hostsChanged)
        await update.mutateAsync({ id: key.id, name, ...(hostsChanged && { hosts: [...input.hosts] }) })
      if (input.owner && input.owner !== ownerValue(key.owner, me.user.id))
        await move.mutateAsync({ id: key.id, owner: ownerInput(input.owner, me.user.id) })
      if (input.value.trim())
        await rotate.mutateAsync({ id: key.id, value: { type: "key", value: input.value.trim() } })
      toast.success(`${key.label} saved`)
      onDone()
    },
  }
}

function KeyForm(props: { credential: Key; onClose: () => void }) {
  const key = props.credential
  const { api } = RouterContext.useRouterContext()
  const me = useMe()
  const owners = ownerOptions(useSpaces().spaces)
  const [name, setName] = useState(() => key.name ?? "")
  const [any, setAny] = useState(() => key.hosts.includes(anyHost))
  const [hosts, setHosts] = useState(() => key.hosts.filter((host) => host !== anyHost).join(", "))
  const [owner, setOwner] = useState(() => ownerValue(key.owner, me.user.id))
  const [value, setValue] = useState("")
  const [error, setError] = useState("")
  const [deleting, setDeleting] = useState(false)
  const remove = useMutation(api.credential.remove.mutationOptions())
  const saving = useSave(key, props.onClose)
  const rotatable = canCopy(key)
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        const listed = any ? [Credential.anyHost] : Credential.splitHosts(hosts)
        if (listed.length === 0) {
          setError("Add at least one website, such as api.stripe.com.")
          return
        }
        setError("")
        void saving
          .save({ name, hosts: listed, owner, value })
          .catch((failure: unknown) => setError(errorMessage(failure, "Couldn’t save the secret. Try again.")))
      }}
    >
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <IconKey className="size-4.5 text-muted-foreground" />
          <span className="truncate">{key.label}</span>
        </SheetTitle>
      </SheetHeader>
      <FieldGroup className="flex-1 gap-6 overflow-y-auto overscroll-contain px-4 pb-4">
        <dl className="flex flex-col gap-2.5 border-b pb-6">
          <Detail label="Type">{typeLabels[key.type]}</Detail>
          {key.keyPreview ? <Detail label="Ends in">…{key.keyPreview}</Detail> : null}
          {key.delivery === "delivered" ? <Detail label="Delivery">In the chat’s environment</Detail> : null}
          {key.account ? <Detail label="Account">{key.account.name}</Detail> : null}
          <Detail label="Created">{formatDate(key.createdAt)}</Detail>
        </dl>
        <Field>
          <FieldLabel htmlFor="key-name">Display name</FieldLabel>
          <Input
            id="key-name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder={key.label}
          />
          <FieldDescription>Shown in lists instead of the env name. Leave empty to use the env name.</FieldDescription>
        </Field>
        {rotatable ? (
          <Field>
            <FieldLabel htmlFor="key-value">New secret</FieldLabel>
            <Input
              id="key-value"
              type="password"
              autoComplete="off"
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
              placeholder="Paste to replace the current secret"
            />
            <FieldDescription>Leave empty to keep the current secret.</FieldDescription>
          </Field>
        ) : null}
        {owner === "" ? null : (
          <Field>
            <FieldLabel>Who can use it</FieldLabel>
            <Select items={owners} value={owner} onValueChange={(next) => setOwner(String(next))}>
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
        )}
        <Field orientation="horizontal">
          <Switch id="key-any-host" checked={any} onCheckedChange={setAny} />
          <FieldLabel htmlFor="key-any-host">Use on any website</FieldLabel>
        </Field>
        {any ? null : (
          <Field>
            <FieldLabel htmlFor="key-hosts">Websites</FieldLabel>
            <Input
              id="key-hosts"
              value={hosts}
              onChange={(event) => setHosts(event.currentTarget.value)}
              placeholder="api.stripe.com"
            />
            <FieldDescription>
              Ren adds the secret only to requests to these hosts. Separate them with commas.
            </FieldDescription>
          </Field>
        )}
        {error ? <FieldError>{error}</FieldError> : null}
      </FieldGroup>
      <SheetFooter className="flex-row">
        <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={() => setDeleting(true)}>
          <IconTrash data-icon="inline-start" />
          Delete
        </Button>
        <SheetClose render={<Button type="button" variant="ghost" />}>Cancel</SheetClose>
        <Button type="submit" disabled={saving.pending}>
          {saving.pending ? <Spinner data-icon="inline-start" /> : null}
          Save
        </Button>
      </SheetFooter>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        confirmation={{
          title: `Delete ${key.label}?`,
          description: `Chats that use ${key.label} lose it at once: their next request to ${key.hosts.includes(anyHost) ? "any website" : key.hosts.join(", ")} gets no secret.`,
          action: "Delete",
        }}
        onConfirm={() =>
          remove.mutateAsync(
            { id: key.id },
            {
              onSuccess: () => {
                toast.success(`${key.label} deleted`)
                props.onClose()
              },
              onError: (failure) => toast.error("Couldn’t delete the secret", { description: errorMessage(failure) }),
            },
          )
        }
      />
    </form>
  )
}

export function KeySheet(props: { credential: Key | undefined; onClose: () => void }) {
  return (
    <Sheet open={props.credential !== undefined} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <SheetContent // ast-grep-ignore: require-overlay-title -- KeyForm renders the SheetTitle
      >
        {props.credential ? (
          <KeyForm key={props.credential.id} credential={props.credential} onClose={props.onClose} />
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
