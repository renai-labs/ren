import type { SessionInfo } from "@ren/client"
import { IconCircle, IconHandStop, IconPlus, IconProgress } from "@tabler/icons-react"
import { keepPreviousData, useInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { Loading } from "@ren/ui/loading"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Tabs } from "@ren/ui/tabs"
import { buttonVariants } from "@ren/ui/button"
import { formatDateTime, formatRelative } from "@ren/ui/time"
import { cn } from "cn"
import { LoadMore } from "../../components/load-more.js"
import {
  PageActions,
  PageTabs,
  PageTabsList,
  PageTabsTrigger,
  TableCard,
  TableEmpty,
  TableSample,
  useShapeId,
} from "../../components/page.js"
import { PersonAvatar } from "../../components/person-avatar.js"
import { RouterContext } from "../../lib/router-context.js"
import {
  inboxColumns,
  origins,
  ownChats,
  sessionTitle,
  sidebarSessionsOptions,
  useChatAttention,
} from "../../lib/sessions.js"
import { pickerPageSize } from "../../lib/pagination.js"
import { useMe } from "../../lib/use-me.js"
import { useMembers } from "../../lib/use-members.js"
import { useNow } from "../../lib/use-now.js"
import { useSpace } from "./use-space.js"

const columnWidths: Readonly<Record<string, string>> = {
  Chat: "w-2/5",
  Agent: "w-40",
  From: "w-32",
  "Last activity": "w-36",
}

const attentionLabels = {
  asking: { label: "Needs input", icon: IconHandStop, className: "text-chart-3" },
  running: { label: "Working", icon: IconProgress, className: "text-chart-2" },
  idle: { label: "Idle", icon: IconCircle, className: "text-muted-foreground" },
} as const

function ChatState(props: { chat: SessionInfo }) {
  const attention = useChatAttention(props.chat.id) ?? (props.chat.status === "busy" ? "running" : "idle")
  const state = attentionLabels[attention]
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <state.icon className={cn("size-3.5", state.className)} />
      {state.label}
    </span>
  )
}

function ChatRow(props: { chat: SessionInfo; agent: string; now: number }) {
  const navigate = useNavigate()
  const chat = props.chat
  const author = useMembers().member(chat.createdBy)
  const origin = origins.find((each) => each.value === chat.origin)
  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => void navigate({ to: "/sessions/$sessionId", params: { sessionId: chat.id } })}
    >
      <TableCell>
        <span className="flex min-w-0 items-center justify-between gap-3">
          <Link
            to="/sessions/$sessionId"
            params={{ sessionId: chat.id }}
            onClick={(event) => event.stopPropagation()}
            title={sessionTitle(chat.title)}
            className="block min-w-0 truncate rounded-sm text-foreground outline-none focus-visible:underline"
          >
            {sessionTitle(chat.title)}
          </Link>
          <ChatState chat={chat} />
        </span>
      </TableCell>
      <TableCell className="truncate text-muted-foreground" title={props.agent}>
        {props.agent}
      </TableCell>
      <TableCell>
        <span className="flex min-w-0 items-center gap-2">
          <PersonAvatar name={author?.name ?? "Former member"} image={author?.image} />
          <span className="truncate">{author?.name ?? "Former member"}</span>
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {origin ? (
          <span className="flex items-center gap-2">
            <origin.icon className="size-4" />
            {origin.label}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums" title={formatDateTime(chat.updatedAt)}>
        {formatRelative(chat.updatedAt, props.now)}
      </TableCell>
    </TableRow>
  )
}

export function SpaceInbox(props: { mine: boolean; onMineChange: (mine: boolean) => void }) {
  const { api, client } = RouterContext.useRouterContext()
  const space = useSpace()
  const me = useMe()
  const now = useNow()
  const agents = useSuspenseQuery(api.agent.list.queryOptions({ spaceId: space.id, page: 1, pageSize: pickerPageSize }))
    .data.items
  const agentName = (agentId: string | null) =>
    agentId === null ? "Ren" : (agents.find((agent) => agent.id === agentId)?.name ?? "Archived agent")
  const shapeId = useShapeId("inbox")
  const list = useInfiniteQuery({
    ...sidebarSessionsOptions(client, { spaceId: [space.id], ...(props.mine && ownChats(me.user.id)) }),
    placeholderData: keepPreviousData,
  })
  const chats = list.data?.pages.flatMap((page) => page.items)
  return (
    <>
      <PageTabs>
        <Tabs
          value={props.mine ? "mine" : "all"}
          onValueChange={(value: string) => props.onMineChange(value === "mine")}
        >
          <PageTabsList>
            <PageTabsTrigger value="all">All</PageTabsTrigger>
            <PageTabsTrigger value="mine">Mine</PageTabsTrigger>
          </PageTabsList>
        </Tabs>
      </PageTabs>
      <PageActions>
        <Link to="/" search={{ spaceId: space.id }} className={buttonVariants()}>
          <IconPlus data-icon="inline-start" />
          New chat
        </Link>
      </PageActions>
      <Loading id={shapeId} loading={!chats} label="Loading chats">
        {chats ? (
          <TableCard className={cn("transition-opacity", list.isPlaceholderData && "opacity-60")}>
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  {inboxColumns.map((column) => (
                    <TableHead key={column} className={columnWidths[column]}>
                      {column}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {chats.length === 0 ? (
                  <TableEmpty columns={inboxColumns.length}>
                    {props.mine ? "You haven’t started a chat in this space yet." : "No chats in this space yet."}
                  </TableEmpty>
                ) : null}
                {chats.map((chat) => (
                  <ChatRow key={chat.id} chat={chat} agent={agentName(chat.agentId)} now={now} />
                ))}
              </TableBody>
            </Table>
          </TableCard>
        ) : (
          <TableSample columns={inboxColumns} />
        )}
      </Loading>
      <LoadMore more={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
    </>
  )
}
