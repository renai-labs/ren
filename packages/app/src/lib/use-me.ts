import { useSuspenseQuery } from "@tanstack/react-query"
import { RouterContext } from "./router-context.js"

export function useMe() {
  const { api } = RouterContext.useRouterContext()
  const me = useSuspenseQuery(api.me.get.queryOptions()).data
  const organization = me.organization
  if (!organization) throw new Error("You aren’t in an organization yet.")
  return { user: me.user, organization }
}
