export * as Seed from "./seed.js"

import type { QueryClient, QueryKey } from "@tanstack/react-query"

interface Listed {
  readonly id: string
  readonly identifier?: string
  readonly slug?: string
}

interface Page<Item> {
  readonly items: ReadonlyArray<Item>
}

type Cached<Item> = Page<Item> | { readonly pages: ReadonlyArray<Page<Item>> }

export function fromList<Item extends Listed>(
  queryClient: QueryClient,
  listKeys: ReadonlyArray<QueryKey>,
  idOrSlug: string,
) {
  const found = () =>
    listKeys
      .flatMap((listKey) => queryClient.getQueriesData<Cached<Item>>({ queryKey: listKey }))
      .flatMap(([queryKey, data]) =>
        (data && "pages" in data ? data.pages : [data]).flatMap((page) =>
          (page?.items ?? []).map((item) => ({ item, updatedAt: queryClient.getQueryState(queryKey)?.dataUpdatedAt })),
        ),
      )
      .find((entry) => [entry.item.id, entry.item.identifier, entry.item.slug].includes(idOrSlug))
  return { initialData: () => found()?.item, initialDataUpdatedAt: () => found()?.updatedAt }
}
