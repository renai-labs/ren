export * as CompleteAuth from "./complete-auth.js"

import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Auth } from "../../lib/auth.js"
import { Platform } from "../../platform/platform.js"

export interface Destination {
  readonly invitationId?: string | undefined
  readonly redirect?: string | undefined
}

export function href(destination: Destination & { readonly join?: boolean }) {
  if (!destination.invitationId) return destination.redirect ?? "/"
  const search = new URLSearchParams({ id: destination.invitationId })
  if (destination.join === true) search.set("join", "true")
  if (destination.redirect) search.set("redirect", destination.redirect)
  return `/invites/accept?${search.toString()}`
}

export async function continueAuthorization(auth: Auth.Client) {
  const result = await auth.oauth2.continue({ created: true })
  if (result.error !== null)
    throw new Error(result.error.message ?? "Couldn’t continue to the app that asked for access.")
}

export function useCompleteAuth(destination: Destination, options?: { readonly continueAuthorization?: boolean }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const auth = Auth.useClient()
  const authorization = Platform.usePlatform().authorizationQuery
  return async () => {
    if (authorization !== undefined) {
      if (options?.continueAuthorization === true) await continueAuthorization(auth)
      return
    }
    queryClient.clear()
    await navigate({ href: href({ ...destination, join: true }) })
  }
}
