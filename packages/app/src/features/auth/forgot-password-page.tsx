import { useState } from "react"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { Button } from "@ren/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Spinner } from "@ren/ui/spinner"
import { AuthLayout, BackButton, FormError } from "../../components/auth-layout.js"
import { describeAuthError } from "../../lib/auth.js"
import { RouterContext } from "../../lib/router-context.js"

const route = getRouteApi("/forgot-password")

export function ForgotPasswordPage() {
  const { auth } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const navigate = useNavigate()
  const [email, setEmail] = useState(search.email ?? "")
  const [sentTo, setSentTo] = useState<string>()
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const send = async () => {
    setError("")
    setPending(true)
    const result = await auth.requestPasswordReset({ email })
    setPending(false)
    if (result.error === null) setSentTo(email)
    else setError(describeAuthError(result.error).message)
  }
  const back = () => void navigate({ to: "/login" })
  return (
    <AuthLayout>
      {sentTo ? (
        <div className="flex flex-col text-sm">
          <p className="text-muted-foreground">If an account exists for</p>
          <p className="font-medium break-all">{sentTo}</p>
          <p className="text-muted-foreground">you’ll get an email with a link to reset your password.</p>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <FieldGroup className="gap-4">
            <FormError>{error}</FormError>
            <FieldDescription>Enter your email and we’ll send you a link to reset your password.</FieldDescription>
            <Field>
              <FieldLabel htmlFor="reset-email">Email</FieldLabel>
              <Input
                className="h-10 bg-card dark:bg-card"
                id="reset-email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this field
                autoFocus
                required
                value={email}
                disabled={pending}
                onChange={(event) => setEmail(event.currentTarget.value)}
              />
            </Field>
            <Button type="submit" className="h-10 w-full" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {pending ? "Sending…" : "Send reset instructions"}
            </Button>
          </FieldGroup>
        </form>
      )}
      <BackButton onClick={back}>Back to sign in</BackButton>
    </AuthLayout>
  )
}
