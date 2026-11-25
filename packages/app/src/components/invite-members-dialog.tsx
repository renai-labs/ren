import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Button } from "@ren/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ren/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { Textarea } from "@ren/ui/textarea"
import { errorMessage } from "../lib/errors.js"
import { isRole, type Role } from "../lib/format.js"
import { RouterContext } from "../lib/router-context.js"
import { useMe } from "../lib/use-me.js"
import { useAddableSpaces, useMembers, useRefreshMembers } from "../lib/use-members.js"
import { useSpaces } from "../lib/use-spaces.js"
import { Choice, roleOptions } from "./settings-shared.js"
import { SpacesField } from "./spaces-field.js"

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

const emailSeparators = /[,;\n]+/u

const angledEmail = /<([^<>]+)>/u

const whitespace = /\s+/u

export function InviteMembersDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { auth, api } = RouterContext.useRouterContext()
  const me = useMe()
  const refresh = useRefreshMembers()
  const names = useSpaces()
  const createSpaceMember = useMutation(api["space-member"].create.mutationOptions())
  const addable = useAddableSpaces()
  const myRole = useMembers().members.find((member) => member.id === me.user.id)?.role
  const roles = roleOptions.filter((option) => option.value !== "owner" || myRole === "owner")
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set())
  const [role, setRole] = useState<Role>("member")
  const [text, setText] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const emails = [
    ...new Set(
      text
        .split(emailSeparators)
        .flatMap((entry) => (angledEmail.exec(entry)?.[1] ?? entry).split(whitespace))
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
  const fail = (form: HTMLFormElement, message: string) => {
    setError(message)
    const field = form.elements.namedItem("emails")
    if (field instanceof HTMLTextAreaElement) field.focus()
  }
  const invite = async () => {
    const spaceIds = [...picked].filter((id) => id !== addable.general?.id)
    const failures: string[] = []
    const retry: string[] = []
    for (const email of emails) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- invitations go one at a time so a failure names its email
      const result = await auth.organization.inviteMember({
        email,
        role,
        organizationId: me.organization.id,
        resend: false,
      })
      if (result.error !== null) {
        failures.push(`Couldn’t invite ${email}. ${result.error.message ?? "Check the address and try again."}`)
        retry.push(email)
        continue
      }
      for (const spaceId of spaceIds) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- spaces go one at a time so a failure names its space
        await createSpaceMember.mutateAsync({ payload: { spaceId, email } }).catch((cause: unknown) => {
          failures.push(
            `Invited ${email}, but couldn’t add them to ${names.spaceName(spaceId)}: ${errorMessage(cause)}. Add them from that space’s Members page.`,
          )
        })
      }
    }
    await refresh()
    if (failures.length === 0)
      toast.success(emails.length === 1 ? "Invitation sent" : `${emails.length} invitations sent`)
    return { failures, retry }
  }
  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) setError("")
        props.onOpenChange(next)
      }}
    >
      <DialogContent>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            const form = event.currentTarget
            const invalid = emails.filter((email) => !emailPattern.test(email))
            if (emails.length === 0) {
              fail(form, "Add at least one email, like name@company.com.")
              return
            }
            if (invalid.length > 0) {
              fail(form, `Not a valid email: ${invalid.join(", ")}. Use the format name@company.com.`)
              return
            }
            setError("")
            setPending(true)
            void invite().then((outcome) => {
              setPending(false)
              setText(outcome.retry.join("\n"))
              if (outcome.failures.length > 0) {
                fail(form, outcome.failures.join("\n"))
                return
              }
              setPicked(new Set())
              props.onOpenChange(false)
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>Invite members</DialogTitle>
            <DialogDescription>
              Invitations are sent by email. Separate addresses with commas or new lines.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field data-invalid={error !== "" || undefined}>
              <FieldLabel htmlFor="invite-emails">Emails</FieldLabel>
              <Textarea
                id="invite-emails"
                name="emails"
                required
                value={text}
                aria-invalid={error === "" ? undefined : true}
                aria-describedby={error === "" ? undefined : "invite-emails-error"}
                onChange={(event) => setText(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
                    event.currentTarget.form?.requestSubmit()
                }}
                placeholder="name@company.com"
                className="min-h-20"
              />
              {error ? (
                <FieldError id="invite-emails-error" className="whitespace-pre-wrap">
                  {error}
                </FieldError>
              ) : null}
            </Field>
            <Field>
              <FieldLabel>Role</FieldLabel>
              <Choice
                label="Invite role"
                options={roles}
                value={role}
                onChange={(value) => setRole(isRole(value) ? value : "member")}
                className="w-full"
              />
            </Field>
            {addable.spaces.length > 0 ? (
              <SpacesField
                spaces={addable.spaces}
                picked={picked}
                onPick={setPicked}
                locked={new Set(addable.general ? [addable.general.id] : [])}
              />
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {emails.length > 1 ? `Invite ${emails.length} people` : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
