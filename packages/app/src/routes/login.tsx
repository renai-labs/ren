import { createFileRoute } from "@tanstack/react-router"
import { AppBoot } from "../components/app-boot.js"
import { LoginPage } from "../features/auth/login-page.js"
import { Routing } from "../lib/routing.js"

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in · Ren" }] }),
  validateSearch: Routing.AuthSearch,
  beforeLoad: (options) => Routing.signedOutGuard(options.context, options.search),
  pendingComponent: AppBoot,
  component: LoginPage,
})
