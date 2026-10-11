import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"

export const Route = createFileRoute("/login")({
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ redirect: Schema.optional(Schema.String) })),
  component: Login,
})

function Login() {
  return <main>Sign in</main>
}
