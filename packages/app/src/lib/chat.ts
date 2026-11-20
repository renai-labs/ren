import { ChatAtoms, type ChatHost, type ChatSession } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { QueryClient } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"
import type { Platform } from "../platform/platform.js"

type Start = { readonly spaceId: string; readonly created: Promise<void>; readonly done: boolean }

const starts = new Map<Session.ID, Start>()

const startListeners = new Set<() => void>()

const setStart = (sessionID: Session.ID, start: Start) => {
  starts.delete(sessionID)
  starts.set(sessionID, start)
  for (const key of [...starts.keys()].slice(0, Math.max(0, starts.size - ChatAtoms.handoffLimit))) starts.delete(key)
  for (const listener of startListeners) listener()
}

const subscribeStarts = (listener: () => void) => {
  startListeners.add(listener)
  return () => startListeners.delete(listener)
}

export const startingChat = (sessionID: Session.ID) => starts.get(sessionID)

export function useStartingChat(sessionID: Session.ID) {
  const start = useSyncExternalStore(subscribeStarts, () => starts.get(sessionID))
  return { creating: start?.done === false, spaceId: start?.spaceId }
}

const optionsOf = (platform: Platform.Info, userId: string): ChatHost.Options => ({
  serverUrl: platform.serverUrl,
  userId,
  storage: platform.storage,
  cache: platform.chatCache,
  fetch: platform.fetch,
  lifecycle: platform.onLifecycle,
  created: (sessionID) => starts.get(sessionID)?.created,
})

export const useCurrentChat = (platform: Platform.Info, userId: string) =>
  ChatReact.useRuntime(optionsOf(platform, userId))

function handoff(platform: Platform.Info, userId: string, sessionID: Session.ID, message: ChatSession.Handoff) {
  ChatReact.runtime(optionsOf(platform, userId)).atoms.handoff(sessionID, message)
}

export function startChat(
  platform: Platform.Info,
  userId: string,
  sessionID: Session.ID,
  input: { readonly spaceId: string; readonly created: Promise<unknown>; readonly message: ChatSession.Handoff },
) {
  const created = input.created.then(
    () => undefined,
    () => undefined,
  )
  setStart(sessionID, { spaceId: input.spaceId, created, done: false })
  void created.then(() => setStart(sessionID, { spaceId: input.spaceId, created, done: true }))
  handoff(platform, userId, sessionID, input.message)
}

export function resetSession(queryClient: QueryClient) {
  ChatReact.forget()
  queryClient.clear()
}
