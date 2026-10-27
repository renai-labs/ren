import { useSuspenseQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import type { SpaceInfo } from "@ren/client"
import { api, pickerPageSize } from "@/lib/api"
import { seedFromLists } from "@/lib/cache"

const route = getRouteApi("/_authed/_shell/spaces/$spaceId")

export function useSpace() {
  const params = route.useParams()
  return useSuspenseQuery({
    ...api.space.get.queryOptions({ idOrSlug: params.spaceId }),
    ...seedFromLists<SpaceInfo>([api.space.list.queryKey()], params.spaceId),
  }).data
}

export const spaceAgentsOptions = (spaceId: string) =>
  api.agent.list.queryOptions({ spaceId, isSubagent: false, page: 1, pageSize: pickerPageSize })
