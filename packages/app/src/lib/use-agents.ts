import { useSuspenseQuery } from "@tanstack/react-query"
import { pickerPageSize } from "./pagination.js"
import { RouterContext } from "./router-context.js"

export function useAgents(spaceId?: string) {
  const { api } = RouterContext.useRouterContext()
  const agents = useSuspenseQuery(
    api.agent.list.queryOptions({
      page: 1,
      pageSize: pickerPageSize,
      isSubagent: false,
      ...(spaceId && { spaceId }),
    }),
  ).data.items
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  return {
    agents,
    agent: (agentId: string | null | undefined) => (agentId ? byId.get(agentId) : undefined),
  }
}
