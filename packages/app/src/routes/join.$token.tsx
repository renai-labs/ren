import { createFileRoute, redirect } from "@tanstack/react-router"
import { OrganizationInviteLink } from "@ren/schema/organization-invite-link"
import { AppBoot } from "../components/app-boot.js"
import { JoinLinkPage } from "../features/invitation/join-link-page.js"
import { Loader } from "../lib/loader.js"
import { sessionOptions } from "../lib/auth.js"

export const Route = createFileRoute("/join/$token")({
  head: () => ({ meta: [{ title: "Join · Ren" }] }),
  beforeLoad: async (options) => {
    const session = await options.context.queryClient.query(sessionOptions(options.context.auth))
    if (!session && !options.params.token.startsWith(OrganizationInviteLink.tokenPrefix))
      throw redirect({ to: "/login", search: { redirect: options.location.href } })
  },
  loader: (options) => {
    const api = options.context.api
    const token = options.params.token
    if (token.startsWith(OrganizationInviteLink.tokenPrefix))
      Loader.start(
        options.context.queryClient.query({
          ...api["organization-join-link"].preview.queryOptions({ token }),
          retry: false,
        }),
      )
    else
      Loader.start(
        options.context.queryClient.query({ ...api["join-link"].preview.queryOptions({ token }), retry: false }),
      )
  },
  pendingComponent: AppBoot,
  component: JoinLinkPage,
})
