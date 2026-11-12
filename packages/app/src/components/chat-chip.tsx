import type { ReactNode } from "react"
import type { SessionInfo } from "@ren/client"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { ChatMention, ChatMentionRaw } from "@ren/ui/chat-mention"
import { formatRelative } from "@ren/ui/time"
import { sessionKeys } from "../lib/chat.js"
import { pickerPageSize } from "../lib/pagination.js"
import { RouterContext } from "../lib/router-context.js"
import { Seed } from "../lib/seed.js"
import { sessionTitle } from "../lib/sessions.js"

const notFound = "Chat not found or not shared with you"

export function ChatChip(props: {
  id: string
  child?: string | undefined
  href?: string | undefined
  label: ReactNode
}) {
  const { api, platform, queryClient } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const open = useParams({ strict: false }).sessionId
  const openChild = useSearch({ strict: false }).child
  const chat = useQuery({
    ...api.session.get.queryOptions({ idOrSlug: props.id }),
    ...Seed.fromList<SessionInfo>(queryClient, [api.session.list.queryKey(), sessionKeys.infinite()], props.id),
    retry: false,
  })
  const subagent = useQuery({
    ...api.session.get.queryOptions({ idOrSlug: props.child ?? "" }),
    ...Seed.fromList<SessionInfo>(
      queryClient,
      [api.session.list.queryKey(), sessionKeys.infinite()],
      props.child ?? "",
    ),
    enabled: props.child !== undefined,
    retry: false,
  })
  const spaces = useQuery(api.space.list.queryOptions({ page: 1, pageSize: pickerPageSize }))
  const info = chat.data
  if (!info) return <ChatMentionRaw href={props.href} label={props.label} note={chat.isError ? notFound : undefined} />
  const space = spaces.data?.items.find((each) => each.id === info.spaceId)
  return (
    <ChatMention
      href={`${platform.appUrl}/sessions/${props.id}${props.child ? `?child=${props.child}` : ""}`}
      title={sessionTitle(info.title)}
      childTitle={subagent.data ? sessionTitle(subagent.data.title, "Subagent") : undefined}
      archived={info.archivedAt !== null}
      current={open === props.id && openChild === props.child}
      details={
        <>
          <span>{[space?.name, info.status === "busy" ? "Working" : "Idle"].filter(Boolean).join(" · ")}</span>
          <span>Updated {formatRelative(info.updatedAt)}</span>
          {info.archivedAt === null ? null : <span>Archived</span>}
        </>
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
