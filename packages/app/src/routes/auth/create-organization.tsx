import { AuthLayout } from "@/components/ren/auth"
import { CreateOrganizationForm } from "@/components/ren/create-organization-dialog"

export function CreateOrganizationPage() {
  return (
    <AuthLayout title="Create organization" description="A shared home for your teams and their work.">
      <CreateOrganizationForm />
    </AuthLayout>
  )
}
