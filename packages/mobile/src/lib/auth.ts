export * as Auth from "./auth.js"

import { expoClient } from "@better-auth/expo/client"
import type { Auth as AuthSchema } from "@ren/schema/auth"
import { hashKey, type QueryClient, queryOptions } from "@tanstack/react-query"
import { createAuthClient } from "better-auth/client"
import { emailOTPClient, organizationClient } from "better-auth/client/plugins"
import { fetch } from "expo/fetch"
import { getItem, getItemAsync, setItem, setItemAsync } from "expo-secure-store"
import { openBrowserAsync } from "expo-web-browser"

export const serverUrl = process.env.EXPO_PUBLIC_REN_URL ?? "https://api.useren.ai"

export const webUrl = process.env.EXPO_PUBLIC_REN_APP_URL ?? "https://useren.ai"

export const openWeb = (path: string) => void openBrowserAsync(new URL(path, `${webUrl}/`).href)

const origin = new URL(serverUrl).origin

// oxlint-disable-next-line ren/no-comments -- Better Auth rejects a cookie-bearing POST without a trusted Origin. Its own origin is always trusted; a server with the Expo plugin replaces it with the app's scheme from `expo-origin` (`ren://` in production, read from the app config).
export const client = createAuthClient({
  baseURL: `${serverUrl}/auth`,
  fetchOptions: { headers: { origin }, catchAllError: true },
  plugins: [
    expoClient({ storagePrefix: "ren", storage: { getItem, getItemAsync, setItem, setItemAsync } }),
    emailOTPClient(),
    organizationClient(),
  ],
})

export const sessionOptions = queryOptions({
  queryKey: ["auth", "session"],
  queryFn: async () => {
    const result = await client.getSession()
    if (result.error) throw new Error(result.error.message ?? "Couldn’t load the session.", { cause: result.error })
    return result.data
  },
  staleTime: Number.POSITIVE_INFINITY,
})

export const organizationsOptions = queryOptions({
  queryKey: ["auth", "organizations"],
  queryFn: async () => {
    const result = await client.organization.list()
    if (result.error)
      throw new Error(result.error.message ?? "Couldn’t load your organizations.", { cause: result.error })
    return result.data
  },
})

export const refreshSession = async (queryClient: QueryClient) => {
  await queryClient.refetchQueries({ queryKey: sessionOptions.queryKey, exact: true })
  queryClient.removeQueries({ predicate: (query) => query.queryHash !== hashKey(sessionOptions.queryKey) })
}

// oxlint-disable-next-line ren/no-comments -- The Expo plugin opens the provider in the system browser and resolves once it returns to the app scheme (`/` becomes `ren:///`, `ren-dev:///` or `ren-preview:///`). An error redirects there too, so the browser always closes; the session cookie exists only when the sign-in worked.
export const signInWithProvider = async (queryClient: QueryClient, provider: AuthSchema.SignInProvider) => {
  const result = await client.signIn.social({
    provider,
    callbackURL: "/",
    newUserCallbackURL: "/",
    errorCallbackURL: "/",
  })
  if (result.error) return result.error
  if ((await client.getCookie()).includes("session_token=")) await refreshSession(queryClient)
  return null
}

const target = (resource: RequestInfo | URL) =>
  new URL(typeof resource === "string" || resource instanceof URL ? resource : resource.url)

export const sessionFetch: typeof globalThis.fetch = Object.assign(
  async (resource: RequestInfo | URL, init?: RequestInit) => {
    const cookie = await client.getCookie()
    if (!cookie || target(resource).origin !== origin) return fetch(resource, init)
    const headers = new Headers(init?.headers ?? (resource instanceof Request ? resource.headers : undefined))
    headers.set("cookie", cookie)
    return fetch(resource, { ...init, headers, credentials: "omit" })
  },
  globalThis.fetch,
)
