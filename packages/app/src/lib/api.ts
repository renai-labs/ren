import { Ren } from "@ren/client"
import { RenQuery } from "@ren/client/react"
import { MutationCache, QueryClient, type QueryKey } from "@tanstack/react-query"

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: { invalidates?: ReadonlyArray<QueryKey> }
  }
}

export const serverUrl = import.meta.env.VITE_REN_API_URL ?? window.location.origin

export const appUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href.replace(/\/$/u, "")

export const credentialedFetch = Object.assign(
  (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    globalThis.fetch(input, { ...init, credentials: "include" }),
  globalThis.fetch,
)

export const client = Ren.make({ baseUrl: serverUrl, fetch: credentialedFetch })

export const api = RenQuery.make(client)

export const pageSize = 25

export const pickerPageSize = 100

export const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
  mutationCache: new MutationCache({
    onSuccess: (_data, _variables, _context, mutation) => {
      const keys = [mutation.options.mutationKey?.slice(0, 1), ...(mutation.meta?.invalidates ?? [])]
      for (const queryKey of keys) if (queryKey) void queryClient.invalidateQueries({ queryKey })
    },
  }),
})

queryClient.setQueryDefaults(api.me.get.queryKey().slice(0, 1), { staleTime: Number.POSITIVE_INFINITY })
queryClient.setQueryDefaults(api["organization-settings"].get.queryKey(), { staleTime: Number.POSITIVE_INFINITY })
queryClient.setQueryDefaults(api.chat.models.queryKey(), { staleTime: 10 * 60_000 })
queryClient.setQueryDefaults(api.task.list.queryKey().slice(0, 1), { staleTime: 30_000 })
queryClient.setQueryDefaults(api.session.list.queryKey().slice(0, 1), { staleTime: 30_000 })

const statusByTag: Record<string, number> = {
  InvalidRequestError: 400,
  UnauthorizedError: 401,
  ForbiddenError: 403,
  NotFoundError: 404,
  ConflictError: 409,
  TooLargeError: 413,
  UnavailableError: 503,
}

export function errorStatus(error: unknown) {
  if (!(error instanceof Error)) return 500
  const declared = statusByTag[error.name]
  if (declared) return declared
  const match = /UnexpectedStatus: (\d{3})/u.exec(error.message)
  return match ? Number(match[1]) : 500
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message && !error.message.startsWith("UnexpectedStatus")
    ? error.message
    : fallback
}

export const profileQueries = [
  api["app-profile"].list.queryKey().slice(0, 1),
  api["app-profile-reach"].space.profiles.queryKey().slice(0, 1),
]
