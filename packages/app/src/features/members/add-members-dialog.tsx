import { Dialog } from "@ren/ui/dialog"
import { Field } from "@ren/ui/field"
import { FormActions } from "@ren/ui/form-actions"
import { Select } from "@ren/ui/select"
import { TextArea } from "@ren/ui/text-area"
import { Toast } from "@ren/ui/toast"
import { useState } from "react"
import { RouterContext } from "../../lib/router-context.js"
import { Members } from "./members.js"

export function AddMembersDialog(props: {
  organizationId: string
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const context = RouterContext.useRouterContext()
  const [text, setText] = useState("")
  const [role, setRole] = useState<Members.Role>("member")
  const [pending, setPending] = useState(false)
  const emails = Members.parseEmails(text)
  const error = emails.invalid.length > 0 ? `Not a valid email: ${emails.invalid.join(", ")}` : undefined
  const submit = async () => {
    if (pending || emails.valid.length === 0 || error !== undefined) return
    setPending(true)
    const results = await Members.sequentially(emails.valid, async (email) => {
      const result = await context.auth.organization.inviteMember({
        email,
        role,
        organizationId: props.organizationId,
        resend: false,
      })
      return { email, failure: result.error === null ? undefined : (result.error.message ?? "Failed to invite") }
    })
    await props.onChanged()
    setPending(false)
    const failed = announce(results)
    if (failed.length === 0) {
      props.onClose()
      return
    }
    setText(failed.map((result) => result.email).join("\n"))
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => (open ? undefined : props.onClose())}
      dismissal={pending ? "blocked" : "allowed"}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Add members</Dialog.Title>
          <Dialog.Description>
            Invitations are sent by email. Separate addresses with commas or new lines.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <Field.Root label="Emails" error={error}>
            <TextArea
              rows={3}
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog exists to take these addresses
              autoFocus
              placeholder="name@company.com"
              invalid={error !== undefined}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return
                event.preventDefault()
                void submit()
              }}
            />
          </Field.Root>
          <Field.Root label="Role">
            <Select.Root label="Invite role" value={role} onValueChange={setRole} options={Members.roleOptions} />
          </Field.Root>
        </Dialog.Body>
        <Dialog.Footer>
          <FormActions.Root>
            <FormActions.Cancel onClick={props.onClose} disabled={pending} />
            <FormActions.Submit pending={pending} pendingLabel="Inviting…" onClick={() => void submit()}>
              {emails.valid.length > 1 ? `Invite ${emails.valid.length} people` : "Send invite"}
            </FormActions.Submit>
          </FormActions.Root>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  )
}

function announce(results: ReadonlyArray<{ email: string; failure: string | undefined }>) {
  const sent = results.filter((result) => result.failure === undefined)
  const failed = results.filter((result) => result.failure !== undefined)
  if (sent.length === 1) Toast.manager.add({ type: "success", title: `Invitation sent to ${sent[0]?.email ?? ""}` })
  if (sent.length > 1) Toast.manager.add({ type: "success", title: `${sent.length} invitations sent` })
  for (const result of failed)
    Toast.manager.add({ type: "error", title: `Couldn’t invite ${result.email}`, description: result.failure })
  return failed
}
