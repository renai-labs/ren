export * as Auth from "./auth.js"

import { oauthProviderClient } from "@better-auth/oauth-provider/client"
import { Auth } from "@ren/schema/auth"
import { queryOptions } from "@tanstack/react-query"
import { useRouteContext } from "@tanstack/react-router"
import { createAuthClient } from "better-auth/client"
import type { BetterAuthClientPlugin } from "better-auth/client"
import { emailOTPClient, organizationClient } from "better-auth/client/plugins"
import { Option, Schema } from "effect"
import type { Platform } from "../platform/platform.js"

const Body = Schema.Record(Schema.String, Schema.Unknown)

const decodeBody = Schema.decodeUnknownOption(Schema.fromJsonString(Body))

const authorizationPaths = /\/(?:sign-in|oauth2)\//u

const oauthClient = (query: string | undefined) =>
  ({
    ...oauthProviderClient(),
    fetchPlugins: [
      {
        id: "ren-authorization-request",
        name: "ren-authorization-request",
        hooks: {
          onRequest: (context) => {
            if (query === undefined || context.method === "GET" || !authorizationPaths.test(String(context.url))) return
            const body =
              typeof context.body === "string"
                ? decodeBody(context.body)
                : Schema.decodeUnknownOption(Body)(context.body ?? {})
            context.body = JSON.stringify({ ...Option.getOrElse(body, () => ({})), oauth_query: query })
          },
        },
      },
    ],
  }) satisfies BetterAuthClientPlugin

export function createClient(platform: Platform.Info) {
  return createAuthClient({
    baseURL: `${platform.serverUrl}/auth`,
    ...(platform.fetch && { fetchOptions: { customFetchImpl: platform.fetch } }),
    plugins: [organizationClient(), emailOTPClient(), oauthClient(platform.authorizationQuery)],
  })
}

export type Client = ReturnType<typeof createClient>

export function useClient() {
  return useRouteContext({ from: "__root__", select: (context) => context.auth })
}

function assertSuccess<Result extends { error: { message?: string | undefined } | null }>(
  result: Result,
  fallback: string,
): asserts result is Extract<Result, { error: null }> {
  if (result.error !== null) throw new Error(result.error.message ?? fallback, { cause: result.error })
}

const sessionKey = ["auth", "session"] as const

export function sessionOptions(client: Client) {
  return queryOptions({
    queryKey: sessionKey,
    queryFn: async (context) => {
      const result = await client.getSession({ fetchOptions: { signal: context.signal } })
      assertSuccess(result, "Failed to load the session")
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
      assertSuccess(result, "Failed to load organizations")
      return result.data
    },
  })
}

const slugTakenCodes = new Set(["ORGANIZATION_ALREADY_EXISTS", "ORGANIZATION_SLUG_ALREADY_TAKEN"])

export function isSlugTaken(error: { code?: string | undefined }) {
  return slugTakenCodes.has(error.code ?? "")
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
      assertSuccess(result, "Failed to load your role")
      return result.data.role
    },
  })
}

export const isAdminRole = Auth.isAdministrator

export const organizationSlug = Auth.organizationSlug

export const consentOrganizationHeader = Auth.consentOrganizationHeader

const organizationKey = (organizationId: string) => ["auth", "organization", organizationId] as const

export function organizationOptions(client: Client, organizationId: string) {
  return queryOptions({
    queryKey: organizationKey(organizationId),
    queryFn: async (context) => {
      const result = await client.organization.getFullOrganization({
        query: { organizationId },
        fetchOptions: { signal: context.signal },
      })
      assertSuccess(result, "Couldn’t load the organization.")
      return result.data
    },
  })
}

const oauthClientKey = (clientId: string) => ["auth", "oauth-client", clientId] as const

export function oauthClientOptions(client: Client, clientId: string) {
  return queryOptions({
    queryKey: oauthClientKey(clientId),
    queryFn: async (context) => {
      const result = await client.oauth2.publicClient({
        query: { client_id: clientId },
        fetchOptions: { signal: context.signal },
      })
      assertSuccess(result, "Couldn’t load the app that asks for access.")
      return result.data
    },
    retry: false,
  })
}
