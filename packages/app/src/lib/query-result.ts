export * as QueryResult from "./query-result.js"

import { AsyncResult } from "effect/reactivity"

export const of = <A>(query: { readonly data: A | undefined; readonly error: unknown }) => {
  if (query.data !== undefined) return AsyncResult.success<A, unknown>(query.data)
  return query.error ? AsyncResult.fail<unknown, A>(query.error) : AsyncResult.initial<A, unknown>(true)
}
