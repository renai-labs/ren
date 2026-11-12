import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ProfileDialog } from "../../components/profile-dialog.js"
import { AppRegistryPages } from "../../lib/app-registry.js"
import { fromRegistry, type CatalogApp } from "../../lib/apps.js"
import { RouterContext } from "../../lib/router-context.js"

export function useRegistryApps(slugs: ReadonlyArray<string>) {
  const { api } = RouterContext.useRouterContext()
  const listed = useQuery({ ...AppRegistryPages.bySlugs(api, slugs), enabled: slugs.length > 0 })
  const found = new Map((listed.data?.items ?? []).map((app) => [app.slug, fromRegistry(app)]))
  return {
    pending: slugs.length > 0 && listed.isPending,
    of: (slug: string) => found.get(slug),
  }
}

export function useAddSheet() {
  const [appId, setAppId] = useState<string>()
  return {
    add: (app: CatalogApp) => setAppId(app.id),
    dialog: appId ? <ProfileDialog appId={appId} chooseSpace onClose={() => setAppId(undefined)} /> : null,
  }
}
