import { Button } from "@ren/ui/button"
import { Field, FieldLabel } from "@ren/ui/field"
import { Form } from "@ren/ui/form"
import { Icon } from "@ren/ui/icon"
import { Input } from "@ren/ui/input"
import { Spinner } from "@ren/ui/spinner"
import { useNavigate } from "@tanstack/react-router"
import { useId, useState } from "react"
import { TextLink } from "../../components/text-link.js"
import { Auth } from "../../lib/auth.js"
import { AuthError } from "./auth-error.js"
import { BackLink } from "./back-link.js"
import { CompleteAuth } from "./complete-auth.js"
import { FormError } from "./form-error.js"
import { AuthSchemas } from "./schemas.js"

type Props = {
  destination: CompleteAuth.Destination
  email: string
  onBack: () => void
  onCodeSent: () => void
}

function useLoginPassword(props: Props) {
  const auth = Auth.useClient()
  const navigate = useNavigate()
  const completeAuth = CompleteAuth.useCompleteAuth(props.destination)
  const [sendingCode, setSendingCode] = useState(false)
  const [error, setError] = useState("")
  const form = Form.useForm({
    defaultValues: { password: "" },
    schema: AuthSchemas.PasswordStep,
    onSubmit: async (value) => {
      setError("")
      const result = await auth.signIn.email({ email: props.email, password: value.password })
      if (result.error === null) {
        await completeAuth()
        return
      }
      const failure = AuthError.describe(result.error)
      if (failure.code === "EMAIL_NOT_VERIFIED") {
        await navigate({ to: "/verify-email", search: { ...props.destination, email: props.email } })
        return
      }
      setError(failure.message)
    },
  })
  const sendCode = async () => {
    setSendingCode(true)
    setError("")
    const result = await auth.emailOtp.sendVerificationOtp({ email: props.email, type: "sign-in" })
    setSendingCode(false)
    if (result.error === null) {
      props.onCodeSent()
      return
    }
    setError(AuthError.describe(result.error).message)
  }
  return { form, error, sendingCode, sendCode }
}

export function LoginPassword(props: Props) {
  const login = useLoginPassword(props)
  const form = login.form
  const sendingCode = login.sendingCode
  const emailId = useId()
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(signingIn) => (
        <>
          <FormError>{login.error}</FormError>
          <Button
            variant="secondary"
            className="h-10 w-full"
            disabled={signingIn || sendingCode}
            onClick={() => void login.sendCode()}
          >
            {sendingCode ? (
              <Spinner aria-hidden data-icon="inline-start" />
            ) : (
              <Icon glyph="Mail" data-icon="inline-start" />
            )}
            Email sign-in code
          </Button>
          <Form.Root form={form}>
            <Field>
              <FieldLabel htmlFor={emailId}>Email</FieldLabel>
              <Input
                id={emailId}
                type="email"
                className="h-10 border-transparent bg-muted"
                value={props.email}
                readOnly
              />
            </Field>
            <form.AppField name="password">
              {(field) => (
                <field.PasswordField
                  label="Password"
                  labelAction={
                    <TextLink appearance="quiet" to="/forgot-password" search={{ email: props.email }}>
                      Forgot your password?
                    </TextLink>
                  }
                  size="large"
                  autoComplete="current-password"
                  placeholder="Your password"
                  // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take a password
                  autoFocus
                  disabled={signingIn || sendingCode}
                />
              )}
            </form.AppField>
            <Button type="submit" className="h-10 w-full" disabled={signingIn || sendingCode}>
              {signingIn ? <Spinner aria-hidden data-icon="inline-start" /> : null}
              {signingIn ? "Signing in…" : "Sign in"}
            </Button>
          </Form.Root>
          <BackLink onClick={props.onBack} />
        </>
      )}
    </form.Subscribe>
  )
}
