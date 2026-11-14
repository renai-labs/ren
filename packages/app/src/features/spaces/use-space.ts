import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import type { SettingsInfo, SpaceInfo } from "@ren/client"
import { toast } from "@ren/ui/sonner"
import { errorMessage } from "../../lib/errors.js"
import { pickerPageSize } from "../../lib/pagination.js"
import { Seed } from "../../lib/seed.js"
import { RouterContext } from "../../lib/router-context.js"
import type { Runtime } from "../../lib/runtime.js"

const route = getRouteApi("/_authed/_shell/spaces/$spaceId")

export function useSpace() {
  const { api, queryClient } = RouterContext.useRouterContext()
  const params = route.useParams()
  return useSuspenseQuery({
    ...api.space.get.queryOptions({ idOrSlug: params.spaceId }),
    ...Seed.fromList<SpaceInfo>(queryClient, [api.space.list.queryKey()], params.spaceId),
  }).data
}

export function useSpaceSettings(spaceId: string) {
  const { api } = RouterContext.useRouterContext()
  const settings = useQuery(api["space-settings"].get.queryOptions({ idOrSlug: spaceId }))
  const update = useMutation(api["space-settings"].update.mutationOptions())
  const current: SettingsInfo = settings.data?.settings ?? {}
  return {
    loading: settings.isPending,
    canUpdate: settings.data?.canUpdate ?? false,
    saving: update.isPending,
    current,
    save: (patch: Partial<SettingsInfo>) =>
      update.mutateAsync(
        { id: spaceId, settings: { ...current, ...patch } },
        { onError: (error) => toast.error("Couldn’t save the settings", { description: errorMessage(error) }) },
      ),
  }
}

export const spaceAgentsOptions = (api: Runtime.Context["api"], spaceId: string) =>
  api.agent.list.queryOptions({ spaceId, isSubagent: false, page: 1, pageSize: pickerPageSize })
