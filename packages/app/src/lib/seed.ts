export * as Seed from "./seed.js"

import type { QueryClient, QueryKey } from "@tanstack/react-query"

interface Listed {
  readonly id: string
  readonly identifier?: string
  readonly slug?: string
}

export function fromList<Item extends Listed>(queryClient: QueryClient, listKey: QueryKey, idOrSlug: string) {
  const found = () =>
    queryClient
      .getQueriesData<{ readonly items: ReadonlyArray<Item> }>({ queryKey: listKey })
      .flatMap(([queryKey, data]) =>
        (data?.items ?? []).map((item) => ({ item, updatedAt: queryClient.getQueryState(queryKey)?.dataUpdatedAt })),
      )
      .find((entry) => [entry.item.id, entry.item.identifier, entry.item.slug].includes(idOrSlug))
  return { initialData: () => found()?.item, initialDataUpdatedAt: () => found()?.updatedAt }
}
