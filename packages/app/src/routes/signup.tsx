import { createFileRoute } from "@tanstack/react-router"
import { AppBoot } from "../components/app-boot.js"
import { SignupPage } from "../features/auth/signup-page.js"
import { Loader } from "../lib/loader.js"
import { Routing } from "../lib/routing.js"

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Create your account · Ren" }] }),
  validateSearch: Routing.AuthSearch,
  beforeLoad: (options) => Routing.signedOutGuard(options.context, options.search),
  loaderDeps: (options) => ({ invitationId: options.search.invitationId }),
  loader: (options) => {
    const invitationId = options.deps.invitationId
    if (invitationId)
      Loader.start(
        options.context.queryClient.query({
          ...options.context.api.invitation.preview.queryOptions({ id: invitationId }),
          retry: false,
        }),
      )
  },
  pendingComponent: AppBoot,
  component: SignupPage,
})
