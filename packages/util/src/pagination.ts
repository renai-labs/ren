export * as Pagination from "./pagination.js"

export const page = <A>(items: ReadonlyArray<A>, input: { readonly page: number; readonly pageSize: number }) => ({
  items: items.slice((input.page - 1) * input.pageSize, input.page * input.pageSize),
  page: input.page,
  pageSize: input.pageSize,
  total: items.length,
})
