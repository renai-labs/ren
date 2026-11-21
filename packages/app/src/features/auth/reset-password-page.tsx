import { AuthError, AuthForm } from "@ren/client"
import { useRef, useState } from "react"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { Button } from "@ren/ui/button"
import { FieldDescription, FieldGroup } from "@ren/ui/field"
import { Spinner } from "@ren/ui/spinner"
import { AuthField, AuthLayout, BackButton, FormError, PasswordInput } from "../../components/auth-layout.js"
import { RouterContext } from "../../lib/router-context.js"

const route = getRouteApi("/reset-password")

export function ResetPasswordPage() {
  const { auth } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const navigate = useNavigate()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [expired, setExpired] = useState(!search.token || search.error !== undefined)
  const passwordInput = useRef<HTMLInputElement>(null)
  const confirmInput = useRef<HTMLInputElement>(null)
  const [passwordError, setPasswordError] = useState("")
  const [confirmError, setConfirmError] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const save = async () => {
    const passwordFailure = AuthForm.passwordError(password)
    const confirmFailure = passwordFailure || password === confirm ? "" : "Enter the same password in both fields."
    setPasswordError(passwordFailure)
    setConfirmError(confirmFailure)
    setError("")
    if (passwordFailure) {
      passwordInput.current?.focus()
      return
    }
    if (confirmFailure) {
      confirmInput.current?.focus()
      return
    }
    setPending(true)
    const result = await auth.resetPassword({ newPassword: password, token: search.token ?? "" })
    setPending(false)
    if (result.error === null) {
      await navigate({ to: "/login" })
      return
    }
    if (result.error.code === "INVALID_TOKEN") setExpired(true)
    else setError(AuthError.describe(result.error).message)
  }
  const requestNew = () => void navigate({ to: "/forgot-password" })
  const back = () => void navigate({ to: "/login" })
  if (expired)
    return (
      <AuthLayout title="This link has expired" description="">
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
    <AuthLayout title="Choose a new password" description="">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <FieldGroup className="gap-4">
          <FormError>{error}</FormError>
          <AuthField id="new-password" label="New password" error={passwordError} hint={AuthForm.passwordHint}>
            {(control) => (
              <PasswordInput
                {...control}
                ref={passwordInput}
                autoComplete="new-password"
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this field
                autoFocus
                value={password}
                disabled={pending}
                onChange={(event) => {
                  setPassword(event.currentTarget.value)
                  setPasswordError("")
                }}
              />
            )}
          </AuthField>
          <AuthField id="confirm-password" label="Confirm new password" error={confirmError}>
            {(control) => (
              <PasswordInput
                {...control}
                ref={confirmInput}
                autoComplete="new-password"
                value={confirm}
                disabled={pending}
                onChange={(event) => {
                  setConfirm(event.currentTarget.value)
                  setConfirmError("")
                }}
              />
            )}
          </AuthField>
          <Button type="submit" className="h-10 w-full" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {pending ? "Saving…" : "Save password"}
          </Button>
        </FieldGroup>
      </form>
      <BackButton onClick={back}>Back to sign in</BackButton>
    </AuthLayout>
  )
}
