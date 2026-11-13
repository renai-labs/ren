import { useSuspenseQuery } from "@tanstack/react-query"
import { pickerPageSize } from "./pagination.js"
import { RouterContext } from "./router-context.js"

export function useSpaces() {
  const { api } = RouterContext.useRouterContext()
  const listed = useSuspenseQuery(api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize })).data.items
  const spaces = listed.filter((space) => space.membershipId !== null || space.canJoin)
  const byId = new Map(listed.map((space) => [space.id, space]))
  return {
    spaces,
    joined: listed.filter((space) => space.membershipId !== null),
    space: (spaceId: string | null | undefined) => (spaceId ? byId.get(spaceId) : undefined),
    spaceName: (spaceId: string | null | undefined) => (spaceId ? (byId.get(spaceId)?.name ?? "Space") : "Space"),
  }
}
