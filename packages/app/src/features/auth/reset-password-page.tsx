import { useState } from "react"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { Button } from "@ren/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Spinner } from "@ren/ui/spinner"
import { AuthLayout, BackButton, FormError, PasswordInput } from "../../components/auth-layout.js"
import { describeAuthError } from "../../lib/auth.js"
import { RouterContext } from "../../lib/router-context.js"

const route = getRouteApi("/reset-password")

export function ResetPasswordPage() {
  const { auth } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const navigate = useNavigate()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [expired, setExpired] = useState(!search.token || search.error !== undefined)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const save = async () => {
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
  }
  const requestNew = () => void navigate({ to: "/forgot-password" })
  const back = () => void navigate({ to: "/login" })
  if (expired)
    return (
      <AuthLayout>
        <div className="flex flex-col gap-4">
          <FieldDescription>
            This reset link has expired or was already used. Request a new one to continue.
          </FieldDescription>
          <Button className="h-10 w-full" onClick={requestNew}>
            Request a new link
          </Button>
        </div>
        <BackButton onClick={back}>Back to sign in</BackButton>
      </AuthLayout>
    )
  return (
    <AuthLayout>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <FieldGroup className="gap-4">
          <FormError>{error}</FormError>
          <Field>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this field
              autoFocus
              value={password}
              disabled={pending}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
            <PasswordInput
              id="confirm-password"
              autoComplete="new-password"
              placeholder="Repeat your new password"
              value={confirm}
              disabled={pending}
              onChange={(event) => setConfirm(event.currentTarget.value)}
            />
          </Field>
          <Button type="submit" className="h-10 w-full" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {pending ? "Saving…" : "Continue"}
          </Button>
        </FieldGroup>
      </form>
      <BackButton onClick={back}>Back to sign in</BackButton>
    </AuthLayout>
  )
}
