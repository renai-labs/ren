import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { auth, isSlugTaken, organizationSlug, slugAvailabilityOptions } from "@/lib/auth"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { resetSession } from "@/lib/chat"

export function CreateOrganizationForm(props: {
  onCreated?: () => void
  footer?: (pending: boolean) => React.ReactNode
}) {
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [takenSlug, setTakenSlug] = useState("")
  const [pending, setPending] = useState(false)
  const slug = organizationSlug(name)
  const debounced = useDebouncedValue(slug, 350)
  const availability = useQuery({
    ...slugAvailabilityOptions(debounced),
    enabled: debounced !== "" && debounced === slug,
  })
  const taken = slug !== "" && (slug === takenSlug || availability.data === "taken")
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
    resetSession()
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
        <Field data-invalid={taken || error !== "" || undefined}>
          <FieldLabel htmlFor="organization-name">Name</FieldLabel>
          <Input
            id="organization-name"
            placeholder="Organization name"
            value={name}
            aria-invalid={taken || error !== "" || undefined}
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
