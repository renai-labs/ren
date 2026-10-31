import { AuthLayout } from "../../components/auth-layout.js"
import { CreateOrganizationForm } from "../../components/create-organization-dialog.js"

export function CreateOrganizationPage() {
  return (
    <AuthLayout title="Create organization" description="A shared home for your teams and their work.">
      <CreateOrganizationForm />
    </AuthLayout>
  )
}
