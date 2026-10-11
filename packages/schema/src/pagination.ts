export * as Pagination from "./pagination.js"

import { Effect, Schema } from "effect"

const maximumPageSize = 100

export const fields = (defaultPageSize: number) => ({
  page: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(1))),
  pageSize: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: maximumPageSize })).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(defaultPageSize)),
  ),
})

export interface Page<Item> {
  readonly items: ReadonlyArray<Item>
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

export const Page = <Item extends Schema.Top>(item: Item) =>
  Schema.Struct({
    items: Schema.Array(item),
    page: Schema.Int,
    pageSize: Schema.Int,
    total: Schema.Int,
  })
