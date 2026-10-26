import type { CredentialInfo } from "@ren/client"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { Dialog } from "@ren/ui/dialog"
import { Form } from "@ren/ui/form"
import { Notice } from "@ren/ui/notice"
import type { Select } from "@ren/ui/select"
import { Toast } from "@ren/ui/toast"
import { useMutation } from "@tanstack/react-query"
import { RouterContext } from "../../lib/router-context.js"
import { Credentials } from "../../components/credentials.js"

export function RotateCredentialDialog(props: {
  credential: CredentialInfo
  onClose: () => void
  onSaved: () => Promise<unknown>
}) {
  const context = RouterContext.useRouterContext()
  const rotate = useMutation(context.api.credential.rotate.mutationOptions())
  const form = Form.useForm({
    defaultValues: { value: "" },
    schema: Credentials.RotateForm,
    onSubmit: async (value) => {
      const saved = await rotate
        .mutateAsync({ id: props.credential.id, value: { type: "key", value: value.value } })
        .catch(() => undefined)
      if (!saved) return
      await props.onSaved()
      props.onClose()
      Toast.manager.add({ type: "success", title: `${props.credential.label} rotated` })
    },
  })
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      dismissal={rotate.isPending ? "blocked" : "allowed"}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Rotate {props.credential.label}</Dialog.Title>
          <Dialog.Description>The next request of every chat uses the new key.</Dialog.Description>
        </Dialog.Header>
        <Form.Root form={form} arrangement="contents">
          <Dialog.Body>
            <form.AppField name="value">
              {(field) => <field.PasswordField label="New key" autoComplete="off" />}
            </form.AppField>
            <Notice tone="danger" placement="inline">
              {rotate.error?.message}
            </Notice>
          </Dialog.Body>
          <Dialog.Footer>
            <form.SubmitButton pendingLabel="Saving…">Rotate key</form.SubmitButton>
          </Dialog.Footer>
        </Form.Root>
      </Dialog.Content>
    </Dialog.Root>
  )
}

export function MoveCredentialDialog(props: {
  credential: CredentialInfo
  action: "move" | "copy"
  owners: ReadonlyArray<Select.Option>
  userId: string
  onClose: () => void
  onSaved: () => Promise<unknown>
}) {
  const context = RouterContext.useRouterContext()
  const move = useMutation(context.api.credential.move.mutationOptions())
  const copy = useMutation(context.api.credential.copy.mutationOptions())
  const pending = move.isPending || copy.isPending
  const current = Credentials.ownerValue(props.credential.owner)
  const targets = props.owners.filter((option) => option.value !== current)
  const form = Form.useForm({
    defaultValues: { owner: targets.at(0)?.value ?? "" },
    schema: Credentials.OwnerForm,
    onSubmit: async (value) => {
      const input = { id: props.credential.id, owner: Credentials.ownerOf(value.owner, props.userId) }
      const saved = await (props.action === "move" ? move.mutateAsync(input) : copy.mutateAsync(input)).catch(
        () => undefined,
      )
      if (!saved) return
      await props.onSaved()
      props.onClose()
      Toast.manager.add({
        type: "success",
        title: `${props.credential.label} ${props.action === "move" ? "moved" : "copied"}`,
      })
    },
  })
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      dismissal={pending ? "blocked" : "allowed"}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>
            {props.action === "move" ? "Move" : "Copy"} {props.credential.label}
          </Dialog.Title>
          <Dialog.Description>
            {props.action === "move"
              ? "Chats of the old owner lose this key at once."
              : "The copy is a separate credential. Rotating one does not change the other."}
          </Dialog.Description>
        </Dialog.Header>
        <Form.Root form={form} arrangement="contents">
          <Dialog.Body>
            <form.AppField name="owner">
              {(field) => <field.Select label="New owner" options={targets} />}
            </form.AppField>
            <Notice tone="danger" placement="inline">
              {(move.error ?? copy.error)?.message}
            </Notice>
          </Dialog.Body>
          <Dialog.Footer>
            <form.SubmitButton pendingLabel="Saving…">
              {props.action === "move" ? "Move credential" : "Copy credential"}
            </form.SubmitButton>
          </Dialog.Footer>
        </Form.Root>
      </Dialog.Content>
    </Dialog.Root>
  )
}

export function DeleteCredentialDialog(props: {
  credential: CredentialInfo | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => Promise<unknown>
}) {
  const context = RouterContext.useRouterContext()
  const remove = useMutation(context.api.credential.remove.mutationOptions())
  const label = props.credential?.label ?? "this credential"
  return (
    <ConfirmationDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={`Delete ${label}?`}
      description={`Chats that use ${label} lose it at once: their next request to ${props.credential?.hosts.join(", ") ?? "its hosts"} gets no key.`}
      confirmLabel="Delete"
      tone="danger"
      onConfirm={async () => {
        if (!props.credential) return
        await remove.mutateAsync({ id: props.credential.id })
        await props.onDeleted()
      }}
      onConfirmed={() => Toast.manager.add({ type: "success", title: `${label} deleted` })}
    />
  )
}
