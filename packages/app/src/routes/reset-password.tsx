import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { ResetPassword } from "../features/auth/reset-password.js"

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Choose a new password · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ token: Schema.optional(Schema.String) })),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const search = Route.useSearch()
  return <ResetPassword token={search.token} />
}
