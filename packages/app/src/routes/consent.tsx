import { createFileRoute, redirect } from "@tanstack/react-router"
import { Schema } from "effect"
import { AppBoot } from "../components/app-boot.js"
import { ConsentPage } from "../features/auth/consent-page.js"
import { sessionOptions } from "../lib/auth.js"

export const Route = createFileRoute("/consent")({
  head: () => ({ meta: [{ title: "Allow access · Ren" }] }),
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ client_id: Schema.optional(Schema.String), scope: Schema.optional(Schema.String) }),
  ),
  beforeLoad: async (options) => {
    const session = await options.context.queryClient.query(sessionOptions(options.context.auth))
    if (!session) throw redirect({ to: "/login", search: { redirect: options.location.href } })
  },
  pendingComponent: AppBoot,
  component: ConsentPage,
})
