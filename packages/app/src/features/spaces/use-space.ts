import { useSuspenseQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import type { SpaceInfo } from "@ren/client"
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

export const spaceAgentsOptions = (api: Runtime.Context["api"], spaceId: string) =>
  api.agent.list.queryOptions({ spaceId, isSubagent: false, page: 1, pageSize: pickerPageSize })
