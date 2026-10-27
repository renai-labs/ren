import { useState } from "react"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { AuthLayout, BackButton, FormError, PasswordInput } from "@/components/ren/auth"
import { auth, describeAuthError } from "@/lib/auth"

const route = getRouteApi("/reset-password")

function useResetPasswordPage() {
  const search = route.useSearch()
  const navigate = useNavigate()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [expired, setExpired] = useState(!search.token || search.error !== undefined)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  return {
    expired,
    password,
    confirm,
    error,
    pending,
    setPassword,
    setConfirm,
    save: async () => {
      if (password.length < 8) {
        setError("Use at least 8 characters.")
        return
      }
      if (password !== confirm) {
        setError("The passwords don’t match.")
        return
      }
      setError("")
      setPending(true)
      const result = await auth.resetPassword({ newPassword: password, token: search.token ?? "" })
      setPending(false)
      if (result.error === null) {
        await navigate({ to: "/login" })
        return
      }
      if (result.error.code === "INVALID_TOKEN") setExpired(true)
      else setError(describeAuthError(result.error).message)
    },
    requestNew: () => void navigate({ to: "/forgot-password" }),
    back: () => void navigate({ to: "/login" }),
  }
}

export function ResetPasswordPage() {
  const page = useResetPasswordPage()
  if (page.expired)
    return (
      <AuthLayout>
        <div className="flex flex-col gap-4">
          <FieldDescription>This reset link has expired or was already used. Request a new one to continue.</FieldDescription>
          <Button className="h-10 w-full" onClick={page.requestNew}>
            Request a new link
          </Button>
        </div>
        <BackButton onClick={page.back}>Back to sign in</BackButton>
      </AuthLayout>
    )
  return (
    <AuthLayout>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void page.save()
        }}
      >
        <FieldGroup className="gap-4">
          <FormError>{page.error}</FormError>
          <Field>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this field
              autoFocus
              value={page.password}
              disabled={page.pending}
              onChange={(event) => page.setPassword(event.currentTarget.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
            <PasswordInput
              id="confirm-password"
              autoComplete="new-password"
              placeholder="Repeat your new password"
              value={page.confirm}
              disabled={page.pending}
              onChange={(event) => page.setConfirm(event.currentTarget.value)}
            />
          </Field>
          <Button type="submit" className="h-10 w-full" disabled={page.pending}>
            {page.pending ? <Spinner data-icon="inline-start" /> : null}
            {page.pending ? "Saving…" : "Continue"}
          </Button>
        </FieldGroup>
      </form>
      <BackButton onClick={page.back}>Back to sign in</BackButton>
    </AuthLayout>
  )
}
