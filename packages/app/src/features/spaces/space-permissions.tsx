import { useQuery } from "@tanstack/react-query"
import { Loading } from "@ren/ui/loading"
import { useShapeId } from "../../components/page.js"
import { PermissionRules, PermissionRulesSample } from "../../components/permission-rules.js"
import { RouterContext } from "../../lib/router-context.js"
import { useMe } from "../../lib/use-me.js"
import { useSpace, useSpaceSettings } from "./use-space.js"

export function SpacePermissionsTab() {
  const { api } = RouterContext.useRouterContext()
  const space = useSpace()
  const settings = useSpaceSettings(space.id)
  const organization = useQuery(api["organization-settings"].get.queryOptions({ idOrSlug: useMe().organization.id }))
  const shapeId = useShapeId("permissions")
  const loading = settings.loading || organization.isPending
  return (
    <Loading id={shapeId} loading={loading} label="Loading permissions">
      {loading ? (
        <PermissionRulesSample />
      ) : (
        <PermissionRules
          rules={settings.current.permissions ?? []}
          inherited={[{ source: "Organization", rules: organization.data?.settings.permissions ?? [] }]}
          scopeName="This space"
          readOnly={!settings.canUpdate}
          saving={settings.saving}
          onSave={(permissions) => settings.save({ permissions: [...permissions] })}
        />
      )}
    </Loading>
  )
}
