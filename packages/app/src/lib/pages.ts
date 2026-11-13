export * as Pages from "./pages.js"

import type { BillingInvoicePage, CredentialListInput, ScheduleListInput } from "@ren/client"
import { infiniteQueryOptions } from "@tanstack/react-query"
import { pageSize } from "./pagination.js"
import type { Runtime } from "./runtime.js"

type Client = Runtime.Context["client"]

type Paging = { readonly page: number; readonly pageSize: number }

const paged = <Page extends Paging & { readonly total: number }>(
  key: readonly [string, ...ReadonlyArray<unknown>],
  fetch: (paging: Paging, signal: AbortSignal) => Promise<Page>,
) =>
  infiniteQueryOptions({
    queryKey: [...key, "pages", { pageSize }] as const,
    queryFn: (context) => fetch({ page: context.pageParam, pageSize }, context.signal),
    initialPageParam: 1,
    getNextPageParam: (last: Page) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  })

export const spaces = (client: Client) =>
  paged(["space", "list"], (paging, signal) => client.space.list(paging, { signal }))

export const spaceMembers = (client: Client, spaceId: string) =>
  paged(["space-member", "list", { spaceId }], (paging, signal) =>
    client["space-member"].list({ spaceId, ...paging }, { signal }),
  )

export const spaceJoinRequests = (client: Client, spaceId: string) =>
  paged(["space-join-request", "list", { spaceId, status: "pending" }], (paging, signal) =>
    client["space-join-request"].list({ spaceId, status: "pending", ...paging }, { signal }),
  )

export const credentials = (client: Client, input: Omit<CredentialListInput, keyof Paging>) =>
  paged(["credential", "list", input], (paging, signal) => client.credential.list({ ...input, ...paging }, { signal }))

export const connectedApps = (client: Client) =>
  paged(["app", "list", { connected: true }], (paging, signal) =>
    client.app.list({ connected: true, ...paging }, { signal }),
  )

export const schedules = (client: Client, input: Omit<ScheduleListInput, keyof Paging>) =>
  paged(["schedule", "list", input], (paging, signal) => client.schedule.list({ ...input, ...paging }, { signal }))

const invoicePageSize = 10

export const invoices = (client: Client) =>
  infiniteQueryOptions({
    queryKey: ["billing", "invoice", "list", "pages", { perPage: invoicePageSize }] as const,
    queryFn: (context) =>
      client.billing.invoice.list({ page: context.pageParam, perPage: invoicePageSize }, { signal: context.signal }),
    initialPageParam: 1,
    getNextPageParam: (last: BillingInvoicePage) => last.nextPage ?? undefined,
  })
