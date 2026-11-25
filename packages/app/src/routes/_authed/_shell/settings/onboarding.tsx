import { createFileRoute } from "@tanstack/react-router"
import { OnboardingPage } from "../../../../features/onboarding/onboarding-page.js"
import { AppRegistryLists } from "../../../../lib/app-registry.js"
import { organizationOptions } from "../../../../lib/auth.js"
import { Loader } from "../../../../lib/loader.js"
import { Onboarding } from "../../../../lib/onboarding.js"

export const Route = createFileRoute("/_authed/_shell/settings/onboarding")({
  head: () => ({ meta: [{ title: "Onboarding · Ren" }] }),
  loader: (options) => {
    const context = options.context
    const organizationId = context.me.organization?.id
    Loader.start(
      context.queryClient.query(context.api.onboarding.get.queryOptions()),
      context.queryClient.query(AppRegistryLists.bySlugs(context.api, Onboarding.appSlugs)),
      ...(organizationId ? [context.queryClient.query(organizationOptions(context.auth, organizationId))] : []),
    )
  },
  component: OnboardingPage,
})
