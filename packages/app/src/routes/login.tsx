import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { AuthSchemas } from "../features/auth/schemas.js"

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ invitationId: AuthSchemas.InvitationId, redirect: AuthSchemas.Redirect }),
  ),
  component: Login,
})

function Login() {
  return <main>Sign in</main>
}
