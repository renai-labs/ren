export * as ChatAttention from "./chat-attention.js"

import type { Session } from "@ren/schema/session"
import { useSyncExternalStore } from "react"
import { Chat } from "./chat.js"

const closed = () => undefined

export function useAttention(chat: Chat.Chat, sessionID: Session.ID) {
  return useSyncExternalStore(chat.atoms.attention.subscribe, () => chat.atoms.attention.read(sessionID), closed)
}
