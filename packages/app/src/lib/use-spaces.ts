import { useSuspenseQuery } from "@tanstack/react-query"
import { pickerPageSize } from "./pagination.js"
import { RouterContext } from "./router-context.js"

export function useSpaces() {
  const { api } = RouterContext.useRouterContext()
  const spaces = useSuspenseQuery(api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize })).data.items
  const byId = new Map(spaces.map((space) => [space.id, space]))
  return {
    spaces,
    joined: spaces.filter((space) => space.membershipId !== null),
    space: (spaceId: string | null | undefined) => (spaceId ? byId.get(spaceId) : undefined),
    spaceName: (spaceId: string | null | undefined) => (spaceId ? (byId.get(spaceId)?.name ?? "Space") : "Space"),
  }
}
