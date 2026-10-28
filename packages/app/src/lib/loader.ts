export * as Loader from "./loader.js"

export function start(...requests: ReadonlyArray<Promise<unknown>>) {
  for (const request of requests) void request.catch(() => undefined)
}

export const required = {
  throwOnError: (_error: unknown, query: { readonly state: { readonly data: unknown } }) =>
    query.state.data === undefined,
}
