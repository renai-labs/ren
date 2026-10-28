import { Button } from "@ren/ui/button"
import { Form } from "@ren/ui/form"
import { PublicShell } from "@ren/ui/public-shell"
import { Spinner } from "@ren/ui/spinner"
import { Text } from "@ren/ui/text"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { Auth } from "../../lib/auth.js"
import { AuthError } from "./auth-error.js"
import { AuthFlowLayout } from "./auth-flow-layout.js"
import { BackLink } from "./back-link.js"
import { FormError } from "./form-error.js"
import { AuthSchemas } from "./schemas.js"

export function ForgotPassword(props: { email?: string | undefined }) {
  const auth = Auth.useClient()
  const [sentTo, setSentTo] = useState<string>()
  const [error, setError] = useState("")
  const form = Form.useForm({
    defaultValues: { email: props.email ?? "" },
    schema: AuthSchemas.EmailStep,
    onSubmit: async (value) => {
      setError("")
      const result = await auth.requestPasswordReset({ email: value.email })
      if (result.error === null) {
        setSentTo(value.email)
        return
      }
      setError(AuthError.describe(result.error).message)
    },
  })
  return (
    <AuthFlowLayout>
      <PublicShell.Step key={sentTo === undefined ? "form" : "sent"}>
        {sentTo === undefined ? (
          <Form.Root form={form}>
            <FormError>{error}</FormError>
            <Text tone="secondary">Enter your email and we’ll send you a link to reset your password.</Text>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(submitting) => (
                <>
                  <form.AppField name="email">
                    {(field) => (
                      <field.TextField
                        label="Email"
                        type="email"
                        size="large"
                        autoComplete="email"
                        placeholder="you@company.com"
                        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the page exists to take this one field
                        autoFocus
                        disabled={submitting}
                      />
                    )}
                  </form.AppField>
                  <Button type="submit" className="h-10 w-full" disabled={submitting}>
                    {submitting ? <Spinner aria-hidden data-icon="inline-start" /> : null}
                    {submitting ? "Sending…" : "Send reset instructions"}
                  </Button>
                </>
              )}
            </form.Subscribe>
          </Form.Root>
        ) : (
          <div className="flex flex-col">
            <Text tone="secondary">If an account exists for</Text>
            <Text purpose="label" element="p" wrapping="anywhere">
              {sentTo}
            </Text>
            <Text tone="secondary">you’ll get an email with a link to reset your password.</Text>
          </div>
        )}
        <BackLink render={<Link to="/login" />}>Back to sign in</BackLink>
      </PublicShell.Step>
    </AuthFlowLayout>
  )
}
