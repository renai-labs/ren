import { Button } from "@ren/ui/button"
import { Form } from "@ren/ui/form"
import { Text } from "@ren/ui/text"
import { TextLink } from "../../components/text-link.js"
import type { CompleteAuth } from "./complete-auth.js"
import { AuthSchemas } from "./schemas.js"

export function LoginEmail(props: {
  destination: CompleteAuth.Destination
  defaultEmail: string
  onContinue: (email: string) => void
}) {
  const form = Form.useForm({
    defaultValues: { email: props.defaultEmail },
    schema: AuthSchemas.EmailStep,
    onSubmit: (value) => props.onContinue(value.email),
  })
  return (
    <>
      <Form.Root form={form}>
        <form.AppField name="email">
          {(field) => (
            <field.TextField
              label="Email"
              type="email"
              size="large"
              autoComplete="email"
              placeholder="you@company.com"
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the step exists to take this one field
              autoFocus
            />
          )}
        </form.AppField>
        <Button type="submit" appearance="primary" size="large" width="full">
          Continue
        </Button>
      </Form.Root>
      <Text tone="secondary" alignment="center">
        Don’t have an account?{" "}
        <TextLink appearance="standalone" to="/signup" search={props.destination}>
          Sign up
        </TextLink>
      </Text>
    </>
  )
}
