import { Dialog } from "@ren/ui/dialog"
import { Form } from "@ren/ui/form"
import { Notice } from "@ren/ui/notice"
import { Text } from "@ren/ui/text"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Schema } from "effect"
import { useState } from "react"
import { Auth } from "../../lib/auth.js"
import { Debounce } from "../../lib/debounce.js"

const slugTaken = "This slug is already in use."

function organizationSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128)
    .replace(/-+$/g, "")
}

const schema = Schema.toStandardSchemaV1(
  Schema.Struct({
    name: Schema.String.check(
      Schema.makeFilter((name) => (name.trim() === "" ? "Name is required." : undefined)),
      Schema.makeFilter((name) =>
        name.trim() !== "" && organizationSlug(name) === ""
          ? "Use at least one letter or number to generate a slug."
          : undefined,
      ),
    ),
  }),
)

export function CreateOrganizationDialog(props: { onOpenChange: (open: boolean) => void }) {
  const auth = Auth.useClient()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState("")
  const [takenSlug, setTakenSlug] = useState("")
  const [pending, setPending] = useState(false)
  const form = Form.useForm({
    defaultValues: { name: "" },
    schema,
    onSubmit: async (value) => {
      const slug = organizationSlug(value.name)
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
    <Dialog.Root open onOpenChange={props.onOpenChange} dismissal={pending ? "blocked" : "allowed"}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Create organization</Dialog.Title>
          <Dialog.Description>A shared home for your teams and their projects.</Dialog.Description>
        </Dialog.Header>
        <Form.Root form={form} arrangement="contents">
          <Dialog.Body>
            <form.Subscribe selector={(state) => organizationSlug(state.values.name)}>
              {(slug) => <NameField form={form} slug={slug} takenSlug={takenSlug} />}
            </form.Subscribe>
            <Notice tone="danger" placement="inline">
              {error}
            </Notice>
          </Dialog.Body>
          <Dialog.Footer>
            <form.SubmitButton pendingLabel="Creating…">Create organization</form.SubmitButton>
          </Dialog.Footer>
        </Form.Root>
      </Dialog.Content>
    </Dialog.Root>
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
