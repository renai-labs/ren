import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

export function useModels(sessionId: string) {
  const models = useQuery(api.chat.models.queryOptions({ id: sessionId }))
  return { models: models.data ?? [], loading: models.isPending }
}
