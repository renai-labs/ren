import { createFileRoute } from "@tanstack/react-router"
import { AppBoot } from "../../../components/app-boot.js"
import { CreateOrganizationPage } from "../../../features/organization/create-organization-page.js"

export const Route = createFileRoute("/_authed/organizations/new")({
  head: () => ({ meta: [{ title: "Create organization · Ren" }] }),
  pendingComponent: AppBoot,
  component: CreateOrganizationPage,
})
