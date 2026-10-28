import { Button } from "@ren/ui/button"
import { Field, FieldLabel } from "@ren/ui/field"
import { Form } from "@ren/ui/form"
import { Input } from "@ren/ui/input"
import { Spinner } from "@ren/ui/spinner"
import { useNavigate } from "@tanstack/react-router"
import { useId, useState } from "react"
import { Auth } from "../../lib/auth.js"
import { AuthError } from "./auth-error.js"
import { BackLink } from "./back-link.js"
import { CompleteAuth } from "./complete-auth.js"
import { FormError } from "./form-error.js"
import { AuthSchemas } from "./schemas.js"

const emailRejections = new Set(["DISPOSABLE_EMAIL", "UNDELIVERABLE_EMAIL_DOMAIN", "ALIAS_EMAIL"])

export function SignupPassword(props: {
  destination: CompleteAuth.Destination
  details: { name: string; email: string }
  onBack: () => void
  onEmailRejected: (message: string) => void
}) {
  const auth = Auth.useClient()
  const navigate = useNavigate()
  const completeAuth = CompleteAuth.useCompleteAuth(props.destination, { continueAuthorization: true })
  const [error, setError] = useState("")
  const emailId = useId()
  const form = Form.useForm({
    defaultValues: { password: "" },
    schema: AuthSchemas.NewPasswordStep,
    onSubmit: async (value) => {
      setError("")
      const result = await auth.signUp.email({
        name: props.details.name,
        email: props.details.email,
        password: value.password,
      })
      if (result.error !== null) {
        const failure = AuthError.describe(result.error)
        if (emailRejections.has(failure.code)) props.onEmailRejected(failure.message)
        else setError(failure.message)
        return
      }
      if (result.data.token === null) {
        await navigate({ to: "/verify-email", search: { ...props.destination, email: props.details.email } })
        return
      }
      await completeAuth()
    },
  })
  return (
    <>
      <FormError>{error}</FormError>
      <Form.Root form={form}>
        <Field>
          <FieldLabel htmlFor={emailId}>Email</FieldLabel>
          <Input
            id={emailId}
            type="email"
            className="h-10 border-transparent bg-muted"
            value={props.details.email}
            readOnly
          />
        </Field>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <>
              <form.AppField name="password">
                {(field) => (
                  <field.PasswordField
                    label="Password"
                    description="At least 8 characters"
                    size="large"
                    autoComplete="new-password"
                    placeholder="Create a password"
                    // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take a password
                    autoFocus
                    disabled={submitting}
                  />
                )}
              </form.AppField>
              <Button type="submit" className="h-10 w-full" disabled={submitting}>
                {submitting ? <Spinner aria-hidden data-icon="inline-start" /> : null}
                {submitting ? "Creating account…" : "Continue"}
              </Button>
            </>
          )}
        </form.Subscribe>
      </Form.Root>
      <BackLink onClick={props.onBack} />
    </>
  )
}
