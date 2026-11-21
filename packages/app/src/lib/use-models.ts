import { useQuery } from "@tanstack/react-query"
import { RouterContext } from "./router-context.js"

export function useModels(sessionId: string, spaceId?: string) {
  const { api } = RouterContext.useRouterContext()
  const models = useQuery(api.chat.models.queryOptions({ id: sessionId, ...(spaceId && { spaceId }) }))
  return { models: models.data?.models ?? [], fallback: models.data?.default, loading: models.isPending }
}
