import { Button } from "@ren/ui/button"
import { Field } from "@ren/ui/field"
import { Form } from "@ren/ui/form"
import { Icon } from "@ren/ui/icon"
import { Notice } from "@ren/ui/notice"
import { TextField } from "@ren/ui/text-field"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { TextLink } from "../../components/text-link.js"
import { Auth } from "../../lib/auth.js"
import { AuthError } from "./auth-error.js"
import { BackLink } from "./back-link.js"
import { CompleteAuth } from "./complete-auth.js"
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
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(signingIn) => (
        <>
          <Notice tone="danger">{login.error}</Notice>
          <Button
            appearance="secondary"
            size="large"
            width="full"
            disabled={signingIn}
            pending={sendingCode}
            leadingIcon={<Icon glyph="Mail" size="small" />}
            onClick={() => void login.sendCode()}
          >
            Email sign-in code
          </Button>
          <Form.Root form={form}>
            <Field.Root label="Email">
              <TextField type="email" size="large" appearance="filled" value={props.email} readOnly />
            </Field.Root>
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
            <Button
              type="submit"
              appearance="primary"
              size="large"
              width="full"
              disabled={sendingCode}
              pending={signingIn}
              pendingLabel="Signing in…"
            >
              Sign in
            </Button>
          </Form.Root>
          <BackLink onClick={props.onBack} />
        </>
      )}
    </form.Subscribe>
  )
}
