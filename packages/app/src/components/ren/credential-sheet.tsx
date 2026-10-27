import { useState } from "react"
import { Credential } from "@ren/schema/credential"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { FieldError } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { api, errorMessage } from "@/lib/api"
import { formText } from "@/lib/format"

export type Owner = { value: string; label: string }

export type OwnerInput =
  | { readonly kind: "org" }
  | { readonly kind: "space"; readonly spaceId: string }
  | { readonly kind: "person"; readonly userId: string }

export const ownerOptions = (spaces: ReadonlyArray<{ id: string; name: string }>): Owner[] => [
  { value: "org", label: "Organization" },
  ...spaces.map((space) => ({
    value: `space:${space.id}`,
    label: space.name,
  })),
  { value: "person", label: "Only me" },
]

export const ownerInput = (value: string, userId: string): OwnerInput => {
  if (value.startsWith("space:")) return { kind: "space", spaceId: value.slice("space:".length) }
  return value === "person" ? { kind: "person", userId } : { kind: "org" }
}

const envName = /^[A-Z_][A-Z0-9_]*$/u

export function CredentialSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  owners: Owner[]
  userId: string
}) {
  const [anyHost, setAnyHost] = useState(false)
  const [owner, setOwner] = useState(props.owners.at(0)?.value ?? "org")
  const [error, setError] = useState("")
  const create = useMutation(api.credential.create.mutationOptions())
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            const label = formText(form, "label").trim()
            const value = formText(form, "value").trim()
            const hosts = anyHost ? [Credential.anyHost] : Credential.splitHosts(formText(form, "hosts"))
            if (!envName.test(label)) {
              setError("Use UPPER_SNAKE_CASE for the env name, starting with a letter or underscore.")
              return
            }
            if (hosts.length === 0) {
              setError("Add at least one host, such as api.stripe.com.")
              return
            }
            setError("")
            create.mutate(
              { payload: { owner: ownerInput(owner, props.userId), label, hosts, value: { type: "key", value } } },
              {
                onSuccess: () => {
                  props.onOpenChange(false)
                  toast.success("Key saved")
                },
                onError: (failure) => setError(errorMessage(failure)),
              },
            )
          }}
        >
          <SheetHeader>
            <SheetTitle>{props.title}</SheetTitle>
            <SheetDescription>{props.description}</SheetDescription>
          </SheetHeader>
          <FieldGroup className="flex-1 gap-6 overflow-y-auto overscroll-contain px-4 pb-4">
            <Field>
              <FieldLabel htmlFor="credential-name">Env name</FieldLabel>
              <Input id="credential-name" name="label" required placeholder="STRIPE_API_KEY" className="font-mono" />
              <FieldDescription>
                Chats see it as an env var that holds ren:&lt;name&gt;. It cannot change later.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="credential-key">Key</FieldLabel>
              <Input
                id="credential-key"
                name="value"
                type="password"
                required
                autoComplete="off"
                placeholder="sk_live_…"
                className="font-mono"
              />
            </Field>
            <Field orientation="horizontal">
              <Switch id="credential-any-host" checked={anyHost} onCheckedChange={setAnyHost} />
              <FieldLabel htmlFor="credential-any-host">Use on any website</FieldLabel>
            </Field>
            {anyHost ? null : (
              <Field>
                <FieldLabel htmlFor="credential-hosts">Websites</FieldLabel>
                <Input id="credential-hosts" name="hosts" required placeholder="api.stripe.com" />
                <FieldDescription>Ren adds the key only to requests to these hosts.</FieldDescription>
              </Field>
            )}
            {props.owners.length > 1 ? (
              <Field>
                <FieldLabel>Who can use it</FieldLabel>
                <Select items={props.owners} value={owner} onValueChange={(value) => setOwner(String(value))}>
                  <SelectTrigger aria-label="Who can use it" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {props.owners.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
          <SheetFooter>
            <SheetClose render={<Button variant="ghost" />}>Cancel</SheetClose>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Spinner data-icon="inline-start" /> : null}
              Save key
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
