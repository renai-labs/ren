import { useSuspenseQuery } from "@tanstack/react-query"
import { canAdministerOptions, organizationOptions } from "./auth.js"
import { useMe } from "./use-me.js"
import { RouterContext } from "./router-context.js"

export function useOrganization() {
  const { auth } = RouterContext.useRouterContext()
  const me = useMe()
  return useSuspenseQuery(organizationOptions(auth, me.organization.id)).data
}

export function useCanAdminister() {
  const { auth } = RouterContext.useRouterContext()
  return useSuspenseQuery(canAdministerOptions(auth)).data
}
