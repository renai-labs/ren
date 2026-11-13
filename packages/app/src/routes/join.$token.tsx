import { createFileRoute, redirect } from "@tanstack/react-router"
import { AppBoot } from "../components/app-boot.js"
import { JoinLinkPage } from "../features/invitation/join-link-page.js"
import { Loader } from "../lib/loader.js"
import { sessionOptions } from "../lib/auth.js"

export const Route = createFileRoute("/join/$token")({
  head: () => ({ meta: [{ title: "Join space · Ren" }] }),
  beforeLoad: async (options) => {
    const session = await options.context.queryClient.query(sessionOptions(options.context.auth))
    if (!session) throw redirect({ to: "/login", search: { redirect: options.location.href } })
  },
  loader: (options) => {
    Loader.start(
      options.context.queryClient.query({
        ...options.context.api["join-link"].preview.queryOptions({ token: options.params.token }),
        retry: false,
      }),
    )
  },
  pendingComponent: AppBoot,
  component: JoinLinkPage,
})
