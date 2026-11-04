export * as Auth from "./auth.js"

import { expoClient } from "@better-auth/expo/client"
import { queryOptions } from "@tanstack/react-query"
import { createAuthClient } from "better-auth/client"
import { emailOTPClient } from "better-auth/client/plugins"
import { fetch } from "expo/fetch"
import { getItem, getItemAsync, setItem, setItemAsync } from "expo-secure-store"

export const serverUrl = process.env.EXPO_PUBLIC_REN_URL ?? "https://api.v2.useren.ai"

export const webUrl = process.env.EXPO_PUBLIC_REN_APP_URL ?? "https://v2.useren.ai/app"

export const client = createAuthClient({
  baseURL: `${serverUrl}/auth`,
  plugins: [
    expoClient({ scheme: "ren", storagePrefix: "ren", storage: { getItem, getItemAsync, setItem, setItemAsync } }),
    emailOTPClient(),
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

const origin = new URL(serverUrl).origin

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
