export * as SessionTitle from "./session-title.js"

import type { ChatState } from "./chat-state.js"
import { Family } from "./family.js"

const untitled = "New chat"

const placeholder = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

export function display(title: string | null | undefined, fallback = untitled) {
  if (!title || placeholder.test(title)) return fallback
  return title
}

export const child = (state: ChatState.State, sessionID: string) =>
  display(Family.childTitle(state, sessionID, ""), "Subagent")
