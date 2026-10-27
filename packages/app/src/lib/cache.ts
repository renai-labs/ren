import type { InfiniteData, QueryKey } from "@tanstack/react-query"
import { queryClient } from "@/lib/api"

interface Listed {
  readonly id: string
  readonly identifier?: string
}

interface ListPage<Item> {
  readonly items: ReadonlyArray<Item>
}

const isInfinite = <Item,>(data: ListPage<Item> | InfiniteData<ListPage<Item>>): data is InfiniteData<ListPage<Item>> =>
  "pages" in data

export function seedFromLists<Item extends Listed>(listKeys: ReadonlyArray<QueryKey>, idOrSlug: string) {
  const found = () =>
    listKeys
      .flatMap((queryKey) => queryClient.getQueriesData<ListPage<Item> | InfiniteData<ListPage<Item>>>({ queryKey }))
      .flatMap(([queryKey, data]) => {
        if (!data) return []
        const items = isInfinite(data) ? data.pages.flatMap((page) => page.items) : data.items
        return items.map((item) => ({ item, updatedAt: queryClient.getQueryState(queryKey)?.dataUpdatedAt }))
      })
      .find((entry) => entry.item.id === idOrSlug || entry.item.identifier === idOrSlug)
  return {
    initialData: () => found()?.item,
    initialDataUpdatedAt: () => found()?.updatedAt,
  }
}
