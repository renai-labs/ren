export * as Auth from "./auth.js"

import { queryOptions } from "@tanstack/react-query"
import { useRouteContext } from "@tanstack/react-router"
import { createAuthClient } from "better-auth/client"
import { emailOTPClient, organizationClient } from "better-auth/client/plugins"
import type { Platform } from "../platform/platform.js"

export function createClient(platform: Platform.Info) {
  return createAuthClient({
    baseURL: `${platform.serverUrl}/api/auth`,
    ...(platform.fetch && { fetchOptions: { customFetchImpl: platform.fetch } }),
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
      if (result.error) throw new Error(result.error.message ?? "Failed to load the session", { cause: result.error })
      return result.data
    },
    staleTime: Infinity,
  })
}

const organizationsKey = ["auth", "organizations"] as const

export function organizationsOptions(client: Client) {
  return queryOptions({
    queryKey: organizationsKey,
    queryFn: async (context) => {
      const result = await client.organization.list({ fetchOptions: { signal: context.signal } })
      if (result.error) throw new Error(result.error.message ?? "Failed to load organizations", { cause: result.error })
      return result.data
    },
  })
}

const slugTakenCodes = new Set(["ORGANIZATION_ALREADY_EXISTS", "ORGANIZATION_SLUG_ALREADY_TAKEN"])

export function isSlugTaken(error: { code?: string | undefined; message?: string | undefined }) {
  return (
    slugTakenCodes.has(error.code ?? "") ||
    /organization (slug already taken|already exists)/i.test(error.message ?? "")
  )
}

const slugKey = (slug: string) => ["auth", "organization-slug", slug] as const

export function slugAvailabilityOptions(client: Client, slug: string) {
  return queryOptions({
    queryKey: slugKey(slug),
    queryFn: async (context) => {
      const result = await client.organization.checkSlug({ slug, fetchOptions: { signal: context.signal } })
      if (!result.error) return "available" as const
      return isSlugTaken(result.error) ? ("taken" as const) : ("unverified" as const)
    },
    retry: false,
  })
}

const activeRoleKey = ["auth", "active-member-role"] as const

export function activeRoleOptions(client: Client) {
  return queryOptions({
    queryKey: activeRoleKey,
    queryFn: async (context) => {
      const result = await client.organization.getActiveMemberRole({ fetchOptions: { signal: context.signal } })
      if (result.error) throw new Error(result.error.message ?? "Failed to load your role", { cause: result.error })
      return result.data.role
    },
  })
}

export const isAdminRole = (role: string) => role === "owner" || role === "admin"

const organizationKey = (organizationId: string) => ["auth", "organization", organizationId] as const

export function organizationOptions(client: Client, organizationId: string) {
  return queryOptions({
    queryKey: organizationKey(organizationId),
    queryFn: async (context) => {
      const result = await client.organization.getFullOrganization({
        query: { organizationId },
        fetchOptions: { signal: context.signal },
      })
      if (result.error)
        throw new Error(result.error.message ?? "Couldn’t load the organization.", { cause: result.error })
      return result.data
    },
  })
}
