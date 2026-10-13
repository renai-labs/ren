import { Space } from "@ren/schema/space"
import { Dialog } from "@ren/ui/dialog"
import { Form } from "@ren/ui/form"
import { Notice } from "@ren/ui/notice"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Schema } from "effect"
import { RouterContext } from "../../lib/router-context.js"

const schema = Schema.toStandardSchemaV1(
  Schema.Struct({ name: Schema.Trim.pipe(Schema.decodeTo(Space.Name)), description: Schema.String }),
)

export function CreateSpaceDialog(props: { onClose: () => void }) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const create = useMutation(context.api.space.create.mutationOptions())
  const form = Form.useForm({
    defaultValues: { name: "", description: "" },
    schema,
    onSubmit: async (value) => {
      const description = value.description.trim()
      const space = await create
        .mutateAsync({ name: value.name.trim(), ...(description && { description }) })
        .catch(() => undefined)
      if (!space) return
      await queryClient.invalidateQueries({ queryKey: context.api.space.list.queryKey() })
      props.onClose()
      await navigate({ to: "/sessions/spaces/$spaceId", params: { spaceId: space.id } })
    },
  })
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      dismissal={create.isPending ? "blocked" : "allowed"}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>New space</Dialog.Title>
          <Dialog.Description>You join it as its first member.</Dialog.Description>
        </Dialog.Header>
        <Form.Root form={form} arrangement="contents">
          <Dialog.Body>
            <form.AppField name="name">
              {(field) => (
                <field.TextField
                  label="Name"
                  placeholder="My space"
                  // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog exists to take this name
                  autoFocus
                />
              )}
            </form.AppField>
            <form.AppField name="description">
              {(field) => (
                <field.TextArea
                  label="Description"
                  necessity="optional"
                  placeholder="What does this space work on?"
                  rows={2}
                />
              )}
            </form.AppField>
            <Notice tone="danger" placement="inline">
              {create.error?.message}
            </Notice>
          </Dialog.Body>
          <Dialog.Footer>
            <form.SubmitButton pendingLabel="Creating…">Create space</form.SubmitButton>
          </Dialog.Footer>
        </Form.Root>
      </Dialog.Content>
    </Dialog.Root>
  )
}
