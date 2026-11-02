import { Loading } from "@ren/ui/loading"
import { Button } from "@ren/ui/button"
import { Field, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { AuthLayout } from "./auth-layout.js"

export function AuthSkeleton(props: {
  title: string
  description?: string | undefined
  fields?: ReadonlyArray<string> | undefined
  action?: string | undefined
}) {
  return (
    <Loading label="Loading account">
      <AuthLayout title={props.title} description={props.description}>
        <FieldGroup>
          {(props.fields ?? ["Email"]).map((name) => (
            <Field key={name}>
              <FieldLabel>{name}</FieldLabel>
              <Input aria-label={name} readOnly className="h-10 bg-card dark:bg-card" />
            </Field>
          ))}
          <Button className="h-10 w-full">{props.action ?? "Continue"}</Button>
        </FieldGroup>
      </AuthLayout>
    </Loading>
  )
}
