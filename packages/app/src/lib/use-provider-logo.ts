import { useQuery } from "@tanstack/react-query"
import { RouterContext } from "./router-context.js"

// oxlint-disable-next-line ren/no-comments -- A provider's logo by its id, from the providers its inference service lists; Ren knows no provider by name.
export function useProviderLogo(providerId: string | undefined) {
  const { api } = RouterContext.useRouterContext()
  const list = useQuery({ ...api.provider.list.queryOptions(), retry: false })
  return list.data?.providers.find((provider) => provider.id === providerId)?.logo
}
