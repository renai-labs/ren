import { createFileRoute } from "@tanstack/react-router"
import { OnboardingPage } from "../../../../features/onboarding/onboarding-page.js"
import { AppRegistryLists } from "../../../../lib/app-registry.js"
import { canAdministerOptions, organizationOptions } from "../../../../lib/auth.js"
import { Loader } from "../../../../lib/loader.js"
import { OnboardingSteps } from "../../../../lib/onboarding-steps.js"

export const Route = createFileRoute("/_authed/_shell/settings/onboarding")({
  head: () => ({ meta: [{ title: "Onboarding · Ren" }] }),
  loader: (options) => {
    const context = options.context
    const organizationId = context.me.organization?.id
    Loader.start(
      context.queryClient.query(context.api.onboarding.get.queryOptions()),
      context.queryClient.query(canAdministerOptions(context.auth)),
      context.queryClient.query(AppRegistryLists.bySlugs(context.api, OnboardingSteps.appSlugs)),
      ...(organizationId ? [context.queryClient.query(organizationOptions(context.auth, organizationId))] : []),
    )
  },
  component: OnboardingPage,
})
