import { useSuspenseQuery } from "@tanstack/react-query"
import { api, pickerPageSize } from "@/lib/api"

export function useAgents(spaceId?: string) {
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
