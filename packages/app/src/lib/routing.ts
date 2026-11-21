export * as Routing from "./routing.js"

import { redirect, useMatches } from "@tanstack/react-router"
import { Schema } from "effect"
import { sessionOptions } from "./auth.js"
import type { Runtime } from "./runtime.js"

export const Redirect = Schema.optional(Schema.String)

export const InvitationId = Schema.optional(Schema.String)

export const AuthSearch = Schema.toStandardSchemaV1(Schema.Struct({ invitationId: InvitationId, redirect: Redirect }))

export const AppSearch = Schema.toStandardSchemaV1(Schema.Struct({ app: Schema.optional(Schema.String) }))

export const useRenderedPath = () =>
  useMatches({ select: (matches) => matches.at(-1)?.pathname.replace(/(.)\/$/u, "$1") ?? "/" })

const safeRedirect = (path: string | undefined) =>
  path?.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : undefined

export async function signedOutGuard(
  context: Runtime.Context,
  search: { readonly redirect?: string | undefined; readonly invitationId?: string | undefined },
) {
  const session = await context.queryClient.query(sessionOptions(context.auth))
  if (session && !context.platform.authorizationQuery) {
    const target = safeRedirect(search.redirect) ?? "/"
    throw redirect({
      href: search.invitationId ? `/invites/accept?id=${encodeURIComponent(search.invitationId)}&join=true` : target,
    })
  }
}
