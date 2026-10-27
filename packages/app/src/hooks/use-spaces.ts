import { useSuspenseQuery } from "@tanstack/react-query"
import { api, pickerPageSize } from "@/lib/api"

export function useSpaces() {
  const spaces = useSuspenseQuery(api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize })).data.items
  const byId = new Map(spaces.map((space) => [space.id, space]))
  return {
    spaces,
    joined: spaces.filter((space) => space.membershipId !== null),
    space: (spaceId: string | null | undefined) => (spaceId ? byId.get(spaceId) : undefined),
    spaceName: (spaceId: string | null | undefined) => (spaceId ? (byId.get(spaceId)?.name ?? "Space") : "Space"),
  }
}
