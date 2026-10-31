import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { AppBoot } from "../components/app-boot.js"
import { ForgotPasswordPage } from "../features/auth/forgot-password-page.js"

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset your password · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ email: Schema.optional(Schema.String) })),
  pendingComponent: AppBoot,
  component: ForgotPasswordPage,
})
