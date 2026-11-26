import { useQuery } from "@tanstack/react-query"
import { RouterContext } from "./router-context.js"

// oxlint-disable-next-line ren/no-comments -- Each provider's logo by its id, from the providers its inference service lists; Ren knows no provider by name.
export function useProviderLogos(): ReadonlyMap<string, string> {
  const { api } = RouterContext.useRouterContext()
  const list = useQuery({ ...api.provider.list.queryOptions(), retry: false })
  return new Map(
    list.data?.providers.flatMap((provider) => (provider.logo ? [[provider.id, provider.logo]] : [])) ?? [],
  )
}

export function useProviderLogo(providerId: string | undefined) {
  return useProviderLogos().get(providerId ?? "")
}
