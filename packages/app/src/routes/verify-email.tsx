import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"
import { AppBoot } from "../components/app-boot.js"
import { VerifyEmailPage } from "../features/auth/verify-email-page.js"
import { Routing } from "../lib/routing.js"

export const Route = createFileRoute("/verify-email")({
  head: () => ({ meta: [{ title: "Verify your email · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({
      email: Schema.optional(Schema.String),
      invitationId: Routing.InvitationId,
      redirect: Routing.Redirect,
    }),
  ),
  pendingComponent: AppBoot,
  component: VerifyEmailPage,
})
