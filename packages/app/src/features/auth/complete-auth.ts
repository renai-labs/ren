export * as CompleteAuth from "./complete-auth.js"

import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

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

export function useCompleteAuth(destination: Destination) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  return async () => {
    queryClient.clear()
    await navigate({ href: href({ ...destination, join: true }) })
  }
}
