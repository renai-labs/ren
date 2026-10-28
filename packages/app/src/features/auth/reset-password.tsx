import { Button, buttonVariants } from "@ren/ui/button"
import { Form } from "@ren/ui/form"
import { Spinner } from "@ren/ui/spinner"
import { Text } from "@ren/ui/text"
import { Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { Auth } from "../../lib/auth.js"
import { AuthError } from "./auth-error.js"
import { AuthFlowLayout } from "./auth-flow-layout.js"
import { BackLink } from "./back-link.js"
import { FormError } from "./form-error.js"
import { AuthSchemas } from "./schemas.js"

export function ResetPassword(props: { token?: string | undefined }) {
  const [expired, setExpired] = useState(false)
  const backToSignIn = <BackLink render={<Link to="/login" />}>Back to sign in</BackLink>
  if (props.token === undefined || expired) {
    return (
      <AuthFlowLayout>
        <div className="flex flex-col gap-4">
          <Text tone="secondary">This reset link has expired or was already used. Request a new one to continue.</Text>
          <Link to="/forgot-password" className={buttonVariants({ className: "h-10 w-full" })}>
            Request a new link
          </Link>
        </div>
        {backToSignIn}
      </AuthFlowLayout>
    )
  }
  return (
    <AuthFlowLayout>
      <ResetPasswordForm token={props.token} onExpired={() => setExpired(true)} />
      {backToSignIn}
    </AuthFlowLayout>
  )
}

function ResetPasswordForm(props: { token: string; onExpired: () => void }) {
  const auth = Auth.useClient()
  const navigate = useNavigate()
  const [error, setError] = useState("")
  const form = Form.useForm({
    defaultValues: { password: "", passwordConfirm: "" },
    schema: AuthSchemas.ResetPassword,
    onSubmit: async (value) => {
      setError("")
      const result = await auth.resetPassword({ newPassword: value.password, token: props.token })
      if (result.error === null) {
        await navigate({ to: "/login" })
        return
      }
      if (result.error.code === "INVALID_TOKEN") {
        props.onExpired()
        return
      }
      setError(AuthError.describe(result.error).message)
    },
  })
  return (
    <Form.Root form={form}>
      <FormError>{error}</FormError>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(submitting) => (
          <>
            <form.AppField name="password">
              {(field) => (
                <field.PasswordField
                  label="New password"
                  size="large"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  // oxlint-disable-next-line jsx-a11y/no-autofocus -- the page exists to take a new password
                  autoFocus
                  disabled={submitting}
                />
              )}
            </form.AppField>
            <form.AppField name="passwordConfirm">
              {(field) => (
                <field.PasswordField
                  label="Confirm new password"
                  size="large"
                  autoComplete="new-password"
                  placeholder="Repeat your new password"
                  disabled={submitting}
                />
              )}
            </form.AppField>
            <Button type="submit" className="h-10 w-full" disabled={submitting}>
              {submitting ? <Spinner aria-hidden data-icon="inline-start" /> : null}
              {submitting ? "Saving…" : "Continue"}
            </Button>
          </>
        )}
      </form.Subscribe>
    </Form.Root>
  )
}
