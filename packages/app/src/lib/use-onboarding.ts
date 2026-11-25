import { useQuery } from "@tanstack/react-query"
import { Onboarding } from "./onboarding.js"
import { RouterContext } from "./router-context.js"
import { useCanAdminister } from "./use-organization.js"

export function useOnboarding() {
  const { api } = RouterContext.useRouterContext()
  const admin = useCanAdminister()
  const onboarding = useQuery(api.onboarding.get.queryOptions())
  if (!onboarding.data) return undefined
  const lists = Onboarding.checklists(onboarding.data, { admin })
  return { info: onboarding.data, progress: lists.progress, tasks: [...lists.personal, ...(lists.organization ?? [])] }
}
