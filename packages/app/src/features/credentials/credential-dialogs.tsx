import type { CredentialInfo } from "@ren/client"
import { ConfirmationDialog } from "@ren/ui/confirmation-dialog"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Form } from "@ren/ui/form"
import { Icon } from "@ren/ui/icon"
import { toast } from "@ren/ui/toast"
import { useMutation } from "@tanstack/react-query"
import type { Owners } from "./owners.js"
import { RouterContext } from "../../lib/router-context.js"
import { Credentials } from "../../components/credentials.js"

export function RotateCredentialDialog(props: { credential: CredentialInfo; onClose: () => void }) {
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
      props.onClose()
      toast.add({ type: "success", title: `${props.credential.label} rotated` })
    },
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !rotate.isPending) props.onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rotate {props.credential.label}</DialogTitle>
          <DialogDescription>The next request of every chat uses the new key.</DialogDescription>
        </DialogHeader>
        <Form.Root form={form} arrangement="contents">
          <div className="flex flex-col gap-4">
            <form.AppField name="value">
              {(field) => <field.PasswordField label="New key" autoComplete="off" />}
            </form.AppField>
            {rotate.error ? (
              <Alert variant="destructive">
                <Icon glyph="AlertCircle" />
                <AlertDescription>{rotate.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter className="sm:justify-end">
            <form.SubmitButton pendingLabel="Saving…">Rotate key</form.SubmitButton>
          </DialogFooter>
        </Form.Root>
      </DialogContent>
    </Dialog>
  )
}

export function MoveCredentialDialog(props: {
  credential: CredentialInfo
  action: "move" | "copy"
  owners: ReadonlyArray<Owners.Option>
  userId: string
  onClose: () => void
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
      props.onClose()
      toast.add({
        type: "success",
        title: `${props.credential.label} ${props.action === "move" ? "moved" : "copied"}`,
      })
    },
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) props.onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {props.action === "move" ? "Move" : "Copy"} {props.credential.label}
          </DialogTitle>
          <DialogDescription>
            {props.action === "move"
              ? "Chats of the old owner lose this key at once."
              : "The copy is a separate credential. Rotating one does not change the other."}
          </DialogDescription>
        </DialogHeader>
        <Form.Root form={form} arrangement="contents">
          <div className="flex flex-col gap-4">
            <form.AppField name="owner">
              {(field) => (
                <field.Select
                  label="New owner"
                  options={targets.map((owner) => ({
                    value: owner.value,
                    label: owner.label,
                    icon: <Icon glyph={owner.glyph} />,
                  }))}
                />
              )}
            </form.AppField>
            {move.error || copy.error ? (
              <Alert variant="destructive">
                <Icon glyph="AlertCircle" />
                <AlertDescription>{(move.error ?? copy.error)?.message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter className="sm:justify-end">
            <form.SubmitButton pendingLabel="Saving…">
              {props.action === "move" ? "Move credential" : "Copy credential"}
            </form.SubmitButton>
          </DialogFooter>
        </Form.Root>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteCredentialDialog(props: {
  credential: CredentialInfo | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
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
      }}
      onConfirmed={() => toast.add({ type: "success", title: `${label} deleted` })}
    />
  )
}
