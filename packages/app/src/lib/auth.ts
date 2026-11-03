export * as Auth from "./auth.js"

import { oauthProviderClient } from "@better-auth/oauth-provider/client"
import { Auth } from "@ren/schema/auth"
import { queryOptions } from "@tanstack/react-query"
import { createAuthClient } from "better-auth/client"
import type { BetterAuthClientPlugin } from "better-auth/client"
import { emailOTPClient, organizationClient } from "better-auth/client/plugins"
import { Option, Schema } from "effect"
import type { Platform } from "../platform/platform.js"

const Body = Schema.Record(Schema.String, Schema.Unknown)
const decodeBody = Schema.decodeUnknownOption(Schema.fromJsonString(Body))
const authorizationPaths = /\/(?:sign-in|oauth2)\//u

const authorizationRequest = (query: string | undefined) =>
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
    plugins: [organizationClient(), emailOTPClient(), authorizationRequest(platform.authorizationQuery)],
  })
}

export type Client = ReturnType<typeof createClient>

function assertSuccess<Result extends { error: { message?: string | undefined } | null }>(
  result: Result,
  fallback: string,
): asserts result is Extract<Result, { error: null }> {
  if (result.error !== null) throw new Error(result.error.message ?? fallback, { cause: result.error })
}

export const authKeys = {
  all: () => ["auth"] as const,
  session: () => ["auth", "session"] as const,
  organizations: () => ["auth", "organizations"] as const,
  organization: (organizationId: string) => ["auth", "organization", organizationId] as const,
  canAdminister: () => ["auth", "can-administer"] as const,
  slug: (slug: string) => ["auth", "organization-slug", slug] as const,
  oauthClient: (clientId: string) => ["auth", "oauth-client", clientId] as const,
  invitations: () => ["auth", "invitations"] as const,
}

export const sessionOptions = (client: Client) =>
  queryOptions({
    queryKey: authKeys.session(),
    queryFn: async (context) => {
      const result = await client.getSession({ fetchOptions: { signal: context.signal } })
      assertSuccess(result, "Failed to load the session")
      return result.data
    },
    staleTime: Number.POSITIVE_INFINITY,
  })

export const organizationsOptions = (client: Client) =>
  queryOptions({
    queryKey: authKeys.organizations(),
    queryFn: async (context) => {
      const result = await client.organization.list({ fetchOptions: { signal: context.signal } })
      assertSuccess(result, "Failed to load organizations")
      return result.data
    },
  })

export const organizationOptions = (client: Client, organizationId: string) =>
  queryOptions({
    queryKey: authKeys.organization(organizationId),
    queryFn: async (context) => {
      const result = await client.organization.getFullOrganization({
        query: { organizationId },
        fetchOptions: { signal: context.signal },
      })
      assertSuccess(result, "Couldn’t load the organization.")
      return result.data
    },
  })

export const canAdministerOptions = (client: Client) =>
  queryOptions({
    queryKey: authKeys.canAdminister(),
    queryFn: async (context) => {
      const result = await client.organization.hasPermission({
        permissions: { organization: ["update"] },
        fetchOptions: { signal: context.signal },
      })
      assertSuccess(result, "Failed to load your permissions")
      return result.data.success
    },
  })

const slugTakenCodes = new Set(["ORGANIZATION_ALREADY_EXISTS", "ORGANIZATION_SLUG_ALREADY_TAKEN"])

export const isSlugTaken = (error: { code?: string | undefined }) => slugTakenCodes.has(error.code ?? "")

export const slugAvailabilityOptions = (client: Client, slug: string) =>
  queryOptions({
    queryKey: authKeys.slug(slug),
    queryFn: async (context) => {
      const result = await client.organization.checkSlug({ slug, fetchOptions: { signal: context.signal } })
      if (!result.error) return "available" as const
      return isSlugTaken(result.error) ? ("taken" as const) : ("unverified" as const)
    },
    retry: false,
  })

export const oauthClientOptions = (client: Client, clientId: string) =>
  queryOptions({
    queryKey: authKeys.oauthClient(clientId),
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

export const organizationSlug = Auth.organizationSlug

export const consentOrganizationHeader = Auth.consentOrganizationHeader

export interface Destination {
  readonly invitationId?: string | undefined
  readonly redirect?: string | undefined
}

export function destinationHref(destination: Destination & { readonly join?: boolean }) {
  if (!destination.invitationId) return destination.redirect ?? "/"
  const search = new URLSearchParams({ id: destination.invitationId })
  if (destination.join === true) search.set("join", "true")
  if (destination.redirect) search.set("redirect", destination.redirect)
  return `/invites/accept?${search.toString()}`
}

export async function continueAuthorization(client: Client) {
  const result = await client.oauth2.continue({ created: true })
  if (result.error !== null)
    throw new Error(result.error.message ?? "Couldn’t continue to the app that asked for access.")
}
