import { useQuery } from "@tanstack/react-query"
import { RouterContext } from "./router-context.js"

export function useModels(sessionId: string) {
  const { api } = RouterContext.useRouterContext()
  const models = useQuery(api.chat.models.queryOptions({ id: sessionId }))
  return { models: models.data ?? [], loading: models.isPending }
}
