import { Session } from "@ren/schema/session"
import { Icon } from "@ren/ui/icon"
import { SidebarMenuButton, SidebarMenuItem, SidebarMenuSkeleton, useSidebar } from "@ren/ui/sidebar"
import { Pagination } from "@ren/schema/pagination"
import { IconActivity, IconCalendar, IconCube } from "@tabler/icons-react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import { lazy, Suspense } from "react"
import { FilterMenu } from "../../components/filter-menu.js"
import { RouterContext } from "../../lib/router-context.js"
import { SessionList } from "../../lib/session-list.js"
import { SessionTitle } from "./session-title.js"

const ChatListStatus = lazy(() =>
  import("./chat-list-status.js").then((module) => ({ default: module.ChatListStatus })),
)

const skeletons = (count: number) =>
  Array.from({ length: count }, (_, index) => (
    <SidebarMenuItem key={`loading-${index}`} aria-hidden={index > 0}>
      {index === 0 ? <output className="sr-only">Loading chats</output> : null}
      <SidebarMenuSkeleton aria-hidden showIcon />
    </SidebarMenuItem>
  ))

export type ChatFilters = Readonly<Record<string, ReadonlyArray<string>>>

const days = { today: 1, week: 7, month: 30 } as const

const isDay = (value: string): value is keyof typeof days => value in days

const matches = (chat: { spaceId: string; status: string; updatedAt: string }, filters: ChatFilters, now: number) => {
  const space = filters["space"] ?? []
  const status = filters["status"] ?? []
  const updated = (filters["updated"] ?? []).filter(isDay)
  return (
    (space.length === 0 || space.includes(chat.spaceId)) &&
    (status.length === 0 || status.includes(chat.status)) &&
    (updated.length === 0 || updated.some((range) => now - Date.parse(chat.updatedAt) <= days[range] * 86_400_000))
  )
}

export function ChatFilterMenu(props: { value: ChatFilters; onChange: (value: ChatFilters) => void }) {
  const context = RouterContext.useRouterContext()
  const spaces = useQuery(
    context.api.space.list.queryOptions({ page: 1, pageSize: Pagination.maximumPageSize, joined: true }),
  )
  return (
    <FilterMenu
      label="Filter chats"
      properties={[
        {
          key: "space",
          label: "Space",
          icon: <IconCube />,
          options: (spaces.data?.items ?? []).map((space) => ({ value: space.id, label: space.name })),
        },
        {
          key: "status",
          label: "Status",
          icon: <IconActivity />,
          options: [
            { value: "busy", label: "Working" },
            { value: "idle", label: "Idle" },
          ],
        },
        {
          key: "updated",
          label: "Updated",
          icon: <IconCalendar />,
          options: [
            { value: "today", label: "Today" },
            { value: "week", label: "Past 7 days" },
            { value: "month", label: "Past 30 days" },
          ],
        },
      ]}
      values={props.value}
      modified={Object.values(props.value).some((values) => values.length > 0)}
      onToggle={(change) => {
        const values = props.value[change.key] ?? []
        props.onChange({
          ...props.value,
          [change.key]: change.checked ? [...values, change.value] : values.filter((each) => each !== change.value),
        })
      }}
      onReset={() => props.onChange({})}
    />
  )
}

export function ChatList(props: { filters: ChatFilters }) {
  const context = RouterContext.useRouterContext()
  const chats = useInfiniteQuery(SessionList.sidebarOptions(context.client))
  const open = useParams({ strict: false, select: (params) => params.sessionId })
  const sidebar = useSidebar()
  if (chats.isPending) return skeletons(6)
  if (chats.isError)
    return (
      <li role="alert" className="flex p-2 text-sm text-destructive">
        Could not load your chats
      </li>
    )
  const all = chats.data.pages.flatMap((page) => page.items)
  const items = all.filter((chat) => matches(chat, props.filters, chats.dataUpdatedAt))
  if (items.length === 0)
    return (
      <li className="flex p-2 text-sm text-sidebar-foreground">
        {all.length === 0 ? "No chats" : "No chats match these filters"}
      </li>
    )
  return (
    <>
      {items.map((chat) => (
        <SidebarMenuItem key={chat.id}>
          <SidebarMenuButton
            className="group-has-data-[sidebar=menu-badge]/menu-item:pr-7"
            isActive={open === chat.id}
            onClick={() => sidebar.setOpenMobile(false)}
            render={<Link to="/sessions/$sessionId" params={{ sessionId: chat.id }} />}
          >
            <Icon glyph="MessageSquare" />
            <span>{SessionTitle.display(chat.title, SessionTitle.untitled)}</span>
          </SidebarMenuButton>
          <Suspense fallback={null}>
            <ChatListStatus sessionID={Session.ID.make(chat.id)} busy={chat.status === "busy"} />
          </Suspense>
        </SidebarMenuItem>
      ))}
      {chats.hasNextPage ? (
        <li
          aria-hidden
          className="h-px shrink-0"
          ref={(node) => {
            if (node === null) return
            const observer = new IntersectionObserver(
              (entries) => {
                if (entries.some((entry) => entry.isIntersecting) && !chats.isFetchingNextPage)
                  void chats.fetchNextPage()
              },
              { root: node.closest("[data-slot=sidebar-group-content]"), rootMargin: "240px 0px" },
            )
            observer.observe(node)
            return () => observer.disconnect()
          }}
        />
      ) : null}
      {chats.isFetchingNextPage ? skeletons(3) : null}
    </>
  )
}
