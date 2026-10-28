import type { Session } from "@ren/schema/session"
import { SidebarMenuBadge } from "@ren/ui/sidebar"
import { Spinner } from "@ren/ui/spinner"
import { StatusDot } from "@ren/ui/status-dot"
import { useRouteContext } from "@tanstack/react-router"
import { Chat } from "../../lib/chat.js"
import { ChatAttention } from "../../lib/chat-attention.js"

export function ChatListStatus(props: { sessionID: Session.ID; busy: boolean }) {
  const context = useRouteContext({ from: "/_authed" })
  const attention =
    ChatAttention.useAttention(Chat.forUser(context.platform, context.me.user.id), props.sessionID) ??
    (props.busy ? "running" : "idle")
  if (attention === "idle") return null
  return (
    <SidebarMenuBadge className="peer-data-[size=default]/menu-button:top-2">
      {attention === "asking" ? (
        <StatusDot tone="accent" label="Needs your input" />
      ) : (
        <Spinner aria-hidden className="size-3 text-muted-foreground" />
      )}
    </SidebarMenuBadge>
  )
}
