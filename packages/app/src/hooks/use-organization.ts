import { useSuspenseQuery } from "@tanstack/react-query"
import { canAdministerOptions, organizationOptions } from "@/lib/auth"
import { useMe } from "@/hooks/use-me"

export function useOrganization() {
  const me = useMe()
  return useSuspenseQuery(organizationOptions(me.organization.id)).data
}

export function useCanAdminister() {
  return useSuspenseQuery(canAdministerOptions()).data === true
}
