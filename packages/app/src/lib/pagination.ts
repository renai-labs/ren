export const currentPage = (search: { readonly page?: number | undefined }) =>
  Math.max(1, Math.floor(search.page ?? 1))

export const pageCount = (total: number, size: number) => Math.max(1, Math.ceil(total / size))

export type PageSlot = number | "start-ellipsis" | "end-ellipsis"

export function pageSlots(page: number, pages: number, siblings = 1): ReadonlyArray<PageSlot> {
  const visible = 2 * siblings + 5
  if (pages <= visible) return Array.from({ length: pages }, (_, index) => index + 1)
  const start = Math.max(2, Math.min(page - siblings, pages - 2 * siblings - 2))
  const end = Math.min(pages - 1, Math.max(page + siblings, 2 * siblings + 3))
  const middle = Array.from({ length: end - start + 1 }, (_, index) => start + index)
  return [
    1,
    ...(start > 2 ? ["start-ellipsis" as const] : []),
    ...middle,
    ...(end < pages - 1 ? ["end-ellipsis" as const] : []),
    pages,
  ]
}

export const lastPageAfterRemoval = (page: number, total: number, size: number, removed = 1) =>
  Math.min(page, pageCount(Math.max(0, total - removed), size))
