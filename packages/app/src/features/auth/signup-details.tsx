import { Button } from "@ren/ui/button"
import { Form } from "@ren/ui/form"
import { Text } from "@ren/ui/text"
import { TextLink } from "../../components/text-link.js"
import type { CompleteAuth } from "./complete-auth.js"
import { GoogleButton } from "./google-button.js"
import { AuthSchemas } from "./schemas.js"

export function SignupDetails(props: {
  destination: CompleteAuth.Destination
  defaults: { name: string; email: string } | undefined
  emailError: string
  onContinue: (details: { name: string; email: string }) => void
}) {
  const form = Form.useForm({
    defaultValues: props.defaults ?? { name: "", email: "" },
    schema: AuthSchemas.SignupDetails,
    onSubmit: props.onContinue,
  })
  const rejected = props.emailError !== ""
  return (
    <>
      <GoogleButton destination={props.destination} />
      <Form.Root form={form}>
        <form.AppField name="name">
          {(field) => (
            <field.TextField
              label="Name"
              size="large"
              autoComplete="name"
              placeholder="Maya Chen"
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step starts with this field
              autoFocus={!rejected}
            />
          )}
        </form.AppField>
        <form.AppField name="email">
          {(field) => (
            <field.TextField
              label="Email"
              type="email"
              size="large"
              autoComplete="email"
              placeholder="you@company.com"
              error={rejected ? props.emailError : undefined}
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- returns people to the address the server rejected
              autoFocus={rejected}
            />
          )}
        </form.AppField>
        <Button type="submit" appearance="primary" size="large" width="full">
          Continue
        </Button>
      </Form.Root>
      <Text tone="secondary" alignment="center">
        Already have an account?{" "}
        <TextLink
          appearance="standalone"
          to="/login"
          search={{ invitationId: props.destination.invitationId, redirect: props.destination.redirect }}
        >
          Sign in
        </TextLink>
      </Text>
    </>
  )
}
