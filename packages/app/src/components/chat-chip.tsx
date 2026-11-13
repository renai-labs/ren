import type { ReactNode } from "react"
import type { SessionInfo } from "@ren/client"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { ChatMention, ChatMentionRaw } from "@ren/ui/chat-mention"
import { formatRelative } from "@ren/ui/time"
import { sessionKeys } from "../lib/chat.js"
import { RouterContext } from "../lib/router-context.js"
import { Seed } from "../lib/seed.js"
import { sessionTitle } from "../lib/sessions.js"

export function ChatChip(props: {
  id: string
  child?: string | undefined
  href?: string | undefined
  label: ReactNode
}) {
  const context = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const chat = useQuery({
    ...context.api.session.get.queryOptions({ idOrSlug: props.id }),
    ...Seed.fromList<SessionInfo>(
      context.queryClient,
      [context.api.session.list.queryKey(), sessionKeys.infinite()],
      props.id,
    ),
    retry: false,
  })
  const subagent = useQuery({
    ...context.api.session.get.queryOptions({ idOrSlug: props.child ?? "" }),
    enabled: props.child !== undefined,
    retry: false,
  })
  if (chat.isError)
    return <ChatMentionRaw href={props.href} label={props.label} note="Chat not found or not shared with you" />
  const info = chat.data
  return (
    <ChatMention
      href={`${context.platform.appUrl}/sessions/${props.id}${props.child ? `?child=${props.child}` : ""}`}
      title={info ? sessionTitle(info.title) : props.label}
      childTitle={subagent.data ? sessionTitle(subagent.data.title, "Subagent") : undefined}
      archived={info !== undefined && info.archivedAt !== null}
      details={
        info ? (
          <>
            <span>{info.status === "busy" ? "Working" : "Idle"}</span>
            <span>Updated {formatRelative(info.updatedAt)}</span>
            {info.archivedAt === null ? null : <span>Archived</span>}
          </>
        ) : undefined
      }
      onOpen={() =>
        void navigate({
          to: "/sessions/$sessionId",
          params: { sessionId: props.id },
          search: props.child ? { child: props.child } : {},
        })
      }
    />
  )
}
