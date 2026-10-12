import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { ForgotPassword } from "../features/auth/forgot-password.js"
import { AuthSchemas } from "../features/auth/schemas.js"

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset password · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ email: AuthSchemas.OptionalEmail })),
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const search = Route.useSearch()
  return <ForgotPassword email={search.email} />
}
