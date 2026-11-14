import { useMutation, useSuspenseQuery } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { Page } from "../../components/page.js"
import { PermissionRules } from "../../components/permission-rules.js"
import { errorMessage } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { useMe } from "../../lib/use-me.js"

export function PermissionsSettingsPage() {
  const { api } = RouterContext.useRouterContext()
  const me = useMe()
  const settings = useSuspenseQuery(api["organization-settings"].get.queryOptions({ idOrSlug: me.organization.id }))
  const update = useMutation(api["organization-settings"].update.mutationOptions())
  return (
    <Page title="Permissions" description="What agents in every space may do, and what they ask first.">
      <PermissionRules
        rules={settings.data.settings.permissions ?? []}
        scopeName="Your organization"
        readOnly={!settings.data.canUpdate}
        saving={update.isPending}
        onSave={(permissions) =>
          update.mutateAsync(
            { id: me.organization.id, settings: { ...settings.data.settings, permissions: [...permissions] } },
            { onError: (error) => toast.error("Couldn’t save the permissions", { description: errorMessage(error) }) },
          )
        }
      />
    </Page>
  )
}
