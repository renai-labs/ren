import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@ren/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Spinner } from "@ren/ui/spinner"
import { isSlugTaken, organizationSlug, slugAvailabilityOptions } from "../lib/auth.js"
import { useDebouncedValue } from "../lib/use-debounced-value.js"
import { resetSession } from "../lib/chat.js"
import { RouterContext } from "../lib/router-context.js"

export function CreateOrganizationForm(props: {
  onCreated?: () => void
  footer?: (pending: boolean) => React.ReactNode
}) {
  const { auth, queryClient } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [takenSlug, setTakenSlug] = useState("")
  const [pending, setPending] = useState(false)
  const slug = organizationSlug(name)
  const debounced = useDebouncedValue(slug, 350)
  const availability = useQuery({
    ...slugAvailabilityOptions(auth, debounced),
    enabled: debounced !== "" && debounced === slug,
  })
  const taken = slug !== "" && (slug === takenSlug || availability.data === "taken")
  const invalid = taken || error !== "" || undefined
  const submit = async () => {
    if (!name.trim()) {
      setError("Enter a name.")
      return
    }
    if (taken) return
    setError("")
    setPending(true)
    const result = await auth.organization.create({ name: name.trim(), slug })
    if (result.error !== null) {
      setPending(false)
      if (isSlugTaken(result.error)) setTakenSlug(slug)
      else setError(result.error.message ?? "Failed to create organization.")
      return
    }
    resetSession(queryClient)
    props.onCreated?.()
    await navigate({ to: "/" })
  }
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <FieldGroup className="gap-4">
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor="organization-name">Name</FieldLabel>
          <Input
            id="organization-name"
            placeholder="Organization name"
            value={name}
            aria-invalid={invalid}
            onChange={(event) => {
              setName(event.currentTarget.value)
              setError("")
            }}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog exists to take this name
            autoFocus
          />
          {slug ? (
            <FieldDescription className="font-mono" aria-live="polite">
              {slug}
            </FieldDescription>
          ) : null}
          {taken ? <FieldError>This slug is already in use.</FieldError> : null}
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
      </FieldGroup>
      {props.footer ? (
        props.footer(pending)
      ) : (
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Create organization
        </Button>
      )}
    </form>
  )
}

export function CreateOrganizationDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>A shared home for your teams and their projects.</DialogDescription>
        </DialogHeader>
        {props.open ? (
          <CreateOrganizationForm
            onCreated={() => props.onOpenChange(false)}
            footer={(pending) => (
              <DialogFooter className="sm:justify-end">
                <Button type="submit" disabled={pending}>
                  {pending ? <Spinner data-icon="inline-start" /> : null}
                  Create organization
                </Button>
              </DialogFooter>
            )}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
