import type { Session } from "@ren/schema/session"
import { ProgressIndicator } from "@ren/ui/progress-indicator"
import { StatusDot } from "@ren/ui/status-dot"
import { useRouteContext } from "@tanstack/react-router"
import { Chat } from "../../lib/chat.js"
import { ChatAttention } from "../../lib/chat-attention.js"

export function ChatListStatus(props: { sessionID: Session.ID }) {
  const context = useRouteContext({ from: "/_authed" })
  const attention = ChatAttention.useAttention(Chat.forUser(context.platform, context.me.user.id), props.sessionID)
  if (attention === "asking") return <StatusDot tone="accent" label="Needs your input" />
  if (attention === "running") return <ProgressIndicator size="extra-small" label="Working" announcement="none" />
  return null
}
