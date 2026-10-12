import { Dialog } from "@ren/ui/dialog"
import { Form } from "@ren/ui/form"
import { FormActions } from "@ren/ui/form-actions"
import { Text } from "@ren/ui/text"
import { Toast } from "@ren/ui/toast"
import { Schema } from "effect"
import { useState } from "react"
import { Auth } from "../../lib/auth.js"

const required = Schema.String.check(Schema.isNonEmpty({ message: "Required" }))

const schema = Schema.toStandardSchemaV1(
  Schema.Struct({
    currentPassword: required,
    newPassword: Schema.String.check(Schema.isMinLength(8, { message: "Must be at least 8 characters" })),
    newPasswordConfirm: required,
    revokeOtherSessions: Schema.Boolean,
  }).check(
    Schema.makeFilter((value) =>
      value.newPassword === value.newPasswordConfirm
        ? undefined
        : { path: ["newPasswordConfirm"], issue: "Passwords do not match" },
    ),
  ),
)

export function PasswordDialog(props: { onClose: () => void }) {
  const auth = Auth.useClient()
  const [error, setError] = useState("")
  const form = Form.useForm({
    defaultValues: { currentPassword: "", newPassword: "", newPasswordConfirm: "", revokeOtherSessions: false },
    schema,
    onSubmit: async (value) => {
      setError("")
      const result = await auth.changePassword({
        currentPassword: value.currentPassword,
        newPassword: value.newPassword,
        revokeOtherSessions: value.revokeOtherSessions,
      })
      if (result.error !== null) {
        setError(result.error.message ?? "Failed to change password")
        return
      }
      Toast.manager.add({ type: "success", title: "Password changed" })
      props.onClose()
    },
  })
  return (
    <Dialog.Root open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Change password</Dialog.Title>
          <Dialog.Description>Confirm your current password, then pick a new one.</Dialog.Description>
        </Dialog.Header>
        <Form.Root form={form} arrangement="contents">
          <Dialog.Body>
            <form.AppField name="currentPassword">
              {(field) => <field.TextField label="Current password" type="password" autoComplete="current-password" />}
            </form.AppField>
            <form.AppField name="newPassword">
              {(field) => <field.TextField label="New password" type="password" autoComplete="new-password" />}
            </form.AppField>
            <form.AppField name="newPasswordConfirm">
              {(field) => <field.TextField label="Confirm new password" type="password" autoComplete="new-password" />}
            </form.AppField>
            <form.AppField name="revokeOtherSessions">
              {(field) => <field.Checkbox label="Sign out other devices" />}
            </form.AppField>
            {error === "" ? null : <Text tone="danger">{error}</Text>}
          </Dialog.Body>
          <Dialog.Footer>
            <FormActions.Root>
              <FormActions.Cancel onClick={props.onClose} />
              <form.SubmitButton pendingLabel="Saving…">Change password</form.SubmitButton>
            </FormActions.Root>
          </Dialog.Footer>
        </Form.Root>
      </Dialog.Content>
    </Dialog.Root>
  )
}
