import { Alert, AlertDescription } from "@ren/ui/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Form } from "@ren/ui/form"
import { Icon } from "@ren/ui/icon"
import { Text } from "@ren/ui/text"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { Auth } from "../../lib/auth.js"
import { Forms } from "../../lib/forms.js"
import { Debounce } from "../../lib/debounce.js"

const slugTaken = "This slug is already in use."

export function CreateOrganizationDialog(props: { onOpenChange: (open: boolean) => void }) {
  const auth = Auth.useClient()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState("")
  const [takenSlug, setTakenSlug] = useState("")
  const [pending, setPending] = useState(false)
  const form = Form.useForm({
    defaultValues: { name: "" },
    schema: Forms.organization,
    onSubmit: async (value) => {
      const slug = Auth.organizationSlug(value.name)
      if (slug === takenSlug) return
      setError("")
      setPending(true)
      const result = await auth.organization.create({ name: value.name.trim(), slug })
      if (result.error !== null) {
        setPending(false)
        if (Auth.isSlugTaken(result.error)) setTakenSlug(slug)
        else setError(result.error.message ?? "Failed to create organization.")
        return
      }
      queryClient.clear()
      props.onOpenChange(false)
      await navigate({ to: "/" })
    },
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open || !pending) props.onOpenChange(open)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>A shared home for your teams and their projects.</DialogDescription>
        </DialogHeader>
        <Form.Root form={form} arrangement="contents">
          <div className="flex flex-col gap-4">
            <form.Subscribe selector={(state) => Auth.organizationSlug(state.values.name)}>
              {(slug) => <NameField form={form} slug={slug} takenSlug={takenSlug} />}
            </form.Subscribe>
            {error ? (
              <Alert variant="destructive">
                <Icon glyph="AlertCircle" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter className="sm:justify-end">
            <form.SubmitButton pendingLabel="Creating…">Create organization</form.SubmitButton>
          </DialogFooter>
        </Form.Root>
      </DialogContent>
    </Dialog>
  )
}

function NameField(props: {
  form: ReturnType<typeof Form.useForm<{ name: string }, { name: string }>>
  slug: string
  takenSlug: string
}) {
  const auth = Auth.useClient()
  const debounced = Debounce.useDebouncedValue(props.slug, 350)
  const availability = useQuery({
    ...Auth.slugAvailabilityOptions(auth, debounced),
    enabled: debounced !== "" && debounced === props.slug,
  })
  const taken = props.slug !== "" && (props.slug === props.takenSlug || availability.data === "taken")
  return (
    <div className="flex flex-col gap-2">
      <props.form.AppField name="name">
        {(field) => (
          <field.TextField
            label="Name"
            placeholder="Organization name"
            error={taken ? slugTaken : undefined}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog exists to take this name
            autoFocus
          />
        )}
      </props.form.AppField>
      {props.slug === "" ? null : (
        <Text purpose="code" tone={taken ? "danger" : "secondary"} element="p" aria-live="polite">
          {props.slug}
        </Text>
      )}
    </div>
  )
}
