import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { AppBoot } from "../components/app-boot.js"
import { ResetPasswordPage } from "../features/auth/reset-password-page.js"

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Choose a new password · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ token: Schema.optional(Schema.String), error: Schema.optional(Schema.String) }),
  ),
  pendingComponent: AppBoot,
  component: ResetPasswordPage,
})
