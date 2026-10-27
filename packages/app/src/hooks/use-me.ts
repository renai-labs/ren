import { useSuspenseQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

export function useMe() {
  const me = useSuspenseQuery(api.me.get.queryOptions()).data
  const organization = me.organization
  if (!organization) throw new Error("You aren’t in an organization yet.")
  return { user: me.user, organization }
}
