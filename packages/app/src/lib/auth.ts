export * as Auth from "./auth.js"

import { queryOptions } from "@tanstack/react-query"
import { useRouteContext } from "@tanstack/react-router"
import { createAuthClient } from "better-auth/client"
import { emailOTPClient, organizationClient } from "better-auth/client/plugins"
import type { Platform } from "../platform/platform.js"

export function createClient(platform: Platform.Info) {
  return createAuthClient({
    baseURL: `${platform.serverUrl}/api/auth`,
    fetchOptions: platform.fetch === undefined ? undefined : { customFetchImpl: platform.fetch },
    plugins: [organizationClient(), emailOTPClient()],
  })
}

export type Client = ReturnType<typeof createClient>

export function useClient() {
  return useRouteContext({ from: "__root__", select: (context) => context.auth })
}

const sessionKey = ["auth", "session"] as const

export function sessionOptions(client: Client) {
  return queryOptions({
    queryKey: sessionKey,
    queryFn: async (context) => {
      const result = await client.getSession({ fetchOptions: { signal: context.signal } })
      if (result.error !== null)
        throw new Error(result.error.message ?? "Failed to load the session", { cause: result.error })
      return result.data
    },
    staleTime: Infinity,
  })
}
