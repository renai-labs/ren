import { useState } from "react"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { AuthLayout, BackButton, FormError } from "@/components/ren/auth"
import { auth, describeAuthError } from "@/lib/auth"

const route = getRouteApi("/forgot-password")

function useForgotPasswordPage() {
  const search = route.useSearch()
  const navigate = useNavigate()
  const [email, setEmail] = useState(search.email ?? "")
  const [sentTo, setSentTo] = useState<string>()
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  return {
    email,
    sentTo,
    error,
    pending,
    setEmail,
    send: async () => {
      setError("")
      setPending(true)
      const result = await auth.requestPasswordReset({ email })
      setPending(false)
      if (result.error === null) setSentTo(email)
      else setError(describeAuthError(result.error).message)
    },
    back: () => void navigate({ to: "/login" }),
  }
}

export function ForgotPasswordPage() {
  const page = useForgotPasswordPage()
  return (
    <AuthLayout>
      {page.sentTo ? (
        <div className="flex flex-col text-sm">
          <p className="text-muted-foreground">If an account exists for</p>
          <p className="font-medium break-all">{page.sentTo}</p>
          <p className="text-muted-foreground">you’ll get an email with a link to reset your password.</p>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void page.send()
          }}
        >
          <FieldGroup className="gap-4">
            <FormError>{page.error}</FormError>
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
                value={page.email}
                disabled={page.pending}
                onChange={(event) => page.setEmail(event.currentTarget.value)}
              />
            </Field>
            <Button type="submit" className="h-10 w-full" disabled={page.pending}>
              {page.pending ? <Spinner data-icon="inline-start" /> : null}
              {page.pending ? "Sending…" : "Send reset instructions"}
            </Button>
          </FieldGroup>
        </form>
      )}
      <BackButton onClick={page.back}>Back to sign in</BackButton>
    </AuthLayout>
  )
}
