export * as SessionLive from "./session-live.js"

import type { Session } from "@ren/schema/session"
import { ChatState } from "./chat-state.js"
import { SessionTitle } from "./session-title.js"

export const of = (
  state: ChatState.State,
  sessionID: string,
): { readonly title?: string; readonly status?: Session.Status } => {
  const info = state.info[sessionID]
  if (!info) return {}
  const title = SessionTitle.display(info.title, "")
  return { ...(title && { title }), status: ChatState.activity(state, sessionID) === "running" ? "busy" : "idle" }
}
