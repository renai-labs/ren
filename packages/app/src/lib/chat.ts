import type { ChatHost, ChatSession } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { QueryClient } from "@tanstack/react-query"
import type { Platform } from "../platform/platform.js"

const optionsOf = (platform: Platform.Info, userId: string): ChatHost.Options => ({
  serverUrl: platform.serverUrl,
  userId,
  storage: platform.storage,
  cache: platform.chatCache,
  fetch: platform.fetch,
  lifecycle: platform.onLifecycle,
})

export const useCurrentChat = (platform: Platform.Info, userId: string) =>
  ChatReact.useRuntime(optionsOf(platform, userId))

export function handoff(platform: Platform.Info, userId: string, sessionID: Session.ID, message: ChatSession.Handoff) {
  ChatReact.runtime(optionsOf(platform, userId)).atoms.handoff(sessionID, message)
}

export function resetSession(queryClient: QueryClient) {
  ChatReact.forget()
  queryClient.clear()
}
