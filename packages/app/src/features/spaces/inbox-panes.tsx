import { SessionTitle } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { SessionPages } from "@ren/client/react"
import type { SessionInfo } from "@ren/client"
import { IconArrowLeft, IconArrowsDiagonal, IconInbox, IconPlus, IconX } from "@tabler/icons-react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"
import { Button, buttonVariants } from "@ren/ui/button"
import { Loading } from "@ren/ui/loading"
import { Tabs } from "@ren/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { formatDateTime } from "@ren/ui/time"
import { LoadMore } from "../../components/load-more.js"
import { PageTabsList, PageTabsTrigger, useShapeId } from "../../components/page.js"
import { AgentAvatar, ResourceAvatar } from "../../components/resource-avatar.js"
import { SessionSheetBody } from "../../components/session-sheet.js"
import { LazySessionThread } from "../session/lazy-session-thread.js"
import { errorStatus } from "../../lib/errors.js"
import { RouterContext } from "../../lib/router-context.js"
import { origins } from "../../lib/sessions.js"
import { useMe } from "../../lib/use-me.js"
import { useMembers } from "../../lib/use-members.js"
import { useNow } from "../../lib/use-now.js"
import { ChatAttention } from "./chat-attention.js"
import { useSpace } from "./use-space.js"

const narrowWidth = 1100

const ages = [
  { suffix: "y", ms: 365 * 86_400_000 },
  { suffix: "mo", ms: 30 * 86_400_000 },
  { suffix: "w", ms: 7 * 86_400_000 },
  { suffix: "d", ms: 86_400_000 },
  { suffix: "h", ms: 3_600_000 },
  { suffix: "m", ms: 60_000 },
] as const

const age = (value: string, now: number) => {
  const elapsed = Math.max(0, now - new Date(value).getTime())
  const found = ages.find((each) => elapsed >= each.ms)
  return found ? `${Math.floor(elapsed / found.ms)}${found.suffix}` : "now"
}

const sample = Array.from({ length: 8 }, (_, index) => index)

export function InboxPanes(props: {
  mine: boolean
  onMineChange: (mine: boolean) => void
  session: string | undefined
  onSessionChange: (session: string | undefined, options: { replace: boolean }) => void
  agentName: (agentId: string | null) => string
  agentIcon: (agentId: string | null) => string | null | undefined
}) {
  const { api, client } = RouterContext.useRouterContext()
  const space = useSpace()
  const me = useMe()
  const now = useNow()
  const members = useMembers()
  const shapeId = useShapeId("inbox")
  const ids = useId()
  const all = useInfiniteQuery(SessionPages.options(client, { spaceId: [space.id] }))
  const own = useInfiniteQuery(SessionPages.options(client, { spaceId: [space.id], ...SessionPages.own(me.user.id) }))
  const list = props.mine ? own : all
  const chats = list.data?.pages.flatMap((page) => page.items)
  const total = list.data?.pages[0]?.total
  const selected = chats?.find((chat) => chat.id === props.session)
  const fetched = useQuery({
    ...api.session.get.queryOptions({ idOrSlug: props.session ?? "" }),
    enabled: props.session !== undefined && chats !== undefined && selected === undefined,
  })
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const [narrow, setNarrow] = useState(false)
  const [active, setActive] = useState<string | undefined>(undefined)
  const reader = useRef<HTMLElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const entering = useRef(false)
  useLayoutEffect(() => {
    if (!root) return
    setNarrow(root.getBoundingClientRect().width < narrowWidth)
    const observer = new ResizeObserver((entries) =>
      setNarrow((entries[0]?.contentRect.width ?? narrowWidth) < narrowWidth),
    )
    observer.observe(root)
    return () => observer.disconnect()
  }, [root])
  const optionId = (chatId: string) => `${ids}-${chatId}`
  const current = chats?.some((chat) => chat.id === active)
    ? active
    : chats?.some((chat) => chat.id === props.session)
      ? props.session
      : chats?.[0]?.id
  const open = (chatId: string) => {
    props.onSessionChange(chatId, { replace: false })
    if (narrow) requestAnimationFrame(() => back.current?.focus())
    else
      requestAnimationFrame(() => {
        entering.current = true
        const target = reader.current?.querySelector<HTMLElement>("textarea") ?? reader.current?.querySelector("button")
        target?.focus()
      })
  }
  const close = () => {
    const chatId = props.session
    props.onSessionChange(undefined, { replace: false })
    if (chatId) requestAnimationFrame(() => document.getElementById(optionId(chatId))?.focus())
  }
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!chats || chats.length === 0) return
    const index = chats.findIndex((chat) => chat.id === current)
    const steps: Readonly<Record<string, number>> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: chats.length - 1,
    }
    const target = steps[event.key]
    if (event.key === "Enter" && current) {
      event.preventDefault()
      return open(current)
    }
    if (event.key === " " && current) {
      event.preventDefault()
      return props.onSessionChange(current, { replace: true })
    }
    if (event.key === "Escape" && props.session && !narrow) {
      event.preventDefault()
      return props.onSessionChange(undefined, { replace: true })
    }
    if (target === undefined) return
    event.preventDefault()
    const next = chats[Math.min(chats.length - 1, Math.max(0, target))]
    if (!next) return
    setActive(next.id)
    document.getElementById(optionId(next.id))?.focus()
    if (!narrow) props.onSessionChange(next.id, { replace: true })
  }
  const info = selected ?? fetched.data
  const missing = [403, 404].includes(errorStatus(fetched.error ?? fetched.failureReason))
  const title = missing ? "Chat not found" : SessionTitle.display(info?.title)
  return (
    <div
      ref={setRoot}
      data-slot="inbox"
      data-page-fill=""
      data-narrow={narrow ? "" : undefined}
      data-reading={props.session ? "" : undefined}
    >
      <section data-slot="inbox-list" aria-labelledby={`${ids}-title`}>
        <header data-slot="inbox-bar">
          <h1 id={`${ids}-title`} data-slot="inbox-title">
            Inbox
          </h1>
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  to="/"
                  search={{ spaceId: space.id }}
                  aria-label="New chat"
                  className={buttonVariants({ variant: "ghost", size: "icon" })}
                />
              }
            >
              <IconPlus aria-hidden />
            </TooltipTrigger>
            <TooltipContent>New chat</TooltipContent>
          </Tooltip>
        </header>
        <div data-slot="inbox-views">
          <Tabs
            value={props.mine ? "mine" : "all"}
            onValueChange={(value: string) => props.onMineChange(value === "mine")}
          >
            <PageTabsList>
              <PageTabsTrigger value="all" count={all.data?.pages[0]?.total}>
                All
              </PageTabsTrigger>
              <PageTabsTrigger value="mine" count={own.data?.pages[0]?.total}>
                Mine
              </PageTabsTrigger>
            </PageTabsList>
          </Tabs>
        </div>
        <div data-slot="inbox-scroll">
          {chats ? (
            chats.length === 0 ? (
              <p data-slot="inbox-empty">
                {props.mine ? "You haven’t started a chat in this space yet." : "No chats in this space yet."}
              </p>
            ) : (
              <div role="listbox" aria-labelledby={`${ids}-title`} data-slot="inbox-rows" onKeyDown={move}>
                {chats.map((chat) => (
                  <InboxRow
                    key={chat.id}
                    id={optionId(chat.id)}
                    chat={chat}
                    now={now}
                    selected={chat.id === props.session}
                    focusable={chat.id === current}
                    agent={props.agentName(chat.agentId)}
                    agentIcon={props.agentIcon(chat.agentId)}
                    author={members.member(chat.createdBy)}
                    onSelect={() => {
                      setActive(chat.id)
                      if (narrow) open(chat.id)
                      else props.onSessionChange(chat.id, { replace: false })
                    }}
                  />
                ))}
              </div>
            )
          ) : (
            <Loading id={shapeId} label="Loading chats">
              <div data-slot="inbox-rows">
                {sample.map((index) => (
                  <div key={index} data-slot="inbox-row">
                    <span data-slot="inbox-avatar">
                      <span data-slot="inbox-mark" />
                    </span>
                    <span data-slot="inbox-lines">
                      <span data-slot="inbox-line">
                        <span data-slot="inbox-row-title">Loading chat title</span>
                      </span>
                      <span data-slot="inbox-line">
                        <span data-slot="inbox-context">Agent · Person · Source</span>
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </Loading>
          )}
          <LoadMore
            more={list.hasNextPage}
            loading={list.isFetchingNextPage}
            onMore={() => void list.fetchNextPage()}
          />
        </div>
      </section>
      <section
        data-slot="inbox-reader"
        ref={reader}
        aria-label={props.session ? title : "Reader"}
        onPointerDownCapture={() => {
          entering.current = true
        }}
        onFocusCapture={(event) => {
          const from = event.relatedTarget
          const bounce = !entering.current && from instanceof HTMLElement && from.getAttribute("role") === "option"
          entering.current = false
          if (bounce) from.focus()
        }}
      >
        {props.session ? (
          <>
            <header data-slot="inbox-bar">
              {narrow ? (
                <Button ref={back} variant="ghost" size="icon" aria-label="Back to inbox" onClick={close}>
                  <IconArrowLeft aria-hidden />
                </Button>
              ) : null}
              <h2 data-slot="inbox-title" title={title}>
                {title}
              </h2>
              {missing ? null : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Link
                        to="/sessions/$sessionId"
                        params={{ sessionId: props.session }}
                        aria-label="Open full page"
                        className={buttonVariants({ variant: "ghost", size: "icon" })}
                      />
                    }
                  >
                    <IconArrowsDiagonal aria-hidden />
                  </TooltipTrigger>
                  <TooltipContent>Open full page</TooltipContent>
                </Tooltip>
              )}
              {narrow ? null : (
                <Tooltip>
                  <TooltipTrigger
                    render={<Button variant="ghost" size="icon" aria-label="Close chat" onClick={close} />}
                  >
                    <IconX aria-hidden />
                  </TooltipTrigger>
                  <TooltipContent>Close</TooltipContent>
                </Tooltip>
              )}
            </header>
            {info ? (
              <SessionSheetBody>
                <LazySessionThread key={props.session} sessionId={props.session} />
              </SessionSheetBody>
            ) : missing ? (
              <div data-slot="inbox-idle">
                <p>This chat was deleted, or it isn’t shared with you.</p>
              </div>
            ) : null}
          </>
        ) : (
          <div data-slot="inbox-idle">
            <IconInbox aria-hidden stroke={1} />
            <p>
              {total === undefined
                ? "Loading chats"
                : total === 0
                  ? "New chats in this space land here"
                  : `${total} ${total === 1 ? "chat" : "chats"}`}
            </p>
          </div>
        )}
      </section>
    </div>
  )
}

function InboxRow(props: {
  id: string
  chat: SessionInfo
  now: number
  selected: boolean
  focusable: boolean
  agent: string
  agentIcon: string | null | undefined
  author: { readonly name: string; readonly image: string | undefined } | undefined
  onSelect: () => void
}) {
  const chat = props.chat
  const attention = ChatReact.useAttention(chat.id, { busy: chat.status === "busy" })
  const state = ChatAttention.labels[attention]
  const origin = origins.find((each) => each.value === chat.origin)
  const name = props.author?.name ?? "Former member"
  const title = SessionTitle.display(chat.title)
  const channel = chat.origin !== "chat" && chat.origin !== "task"
  return (
    <div
      id={props.id}
      role="option"
      aria-selected={props.selected}
      tabIndex={props.focusable ? 0 : -1}
      data-slot="inbox-row"
      data-attention={attention}
      onClick={props.onSelect}
    >
      <span data-slot="inbox-avatar" aria-hidden>
        {channel && origin ? (
          <span data-slot="inbox-mark">
            <origin.icon aria-hidden />
          </span>
        ) : chat.origin === "task" ? (
          <AgentAvatar icon={props.agentIcon} />
        ) : (
          <ResourceAvatar icon={props.author?.image} fallback={name.charAt(0).toUpperCase()} />
        )}
        {origin && !channel ? (
          <span data-slot="inbox-badge">
            <origin.icon aria-hidden />
          </span>
        ) : null}
      </span>
      <span data-slot="inbox-lines">
        <span data-slot="inbox-line">
          <span data-slot="inbox-row-title" title={title}>
            {title}
          </span>
          <span data-slot="inbox-state" role="img" aria-label={state.label} title={state.label}>
            <state.icon aria-hidden className={state.className} />
          </span>
        </span>
        <span data-slot="inbox-line">
          <span data-slot="inbox-context">{[props.agent, name, origin?.label].filter(Boolean).join(" · ")}</span>
          <time data-slot="inbox-age" dateTime={chat.updatedAt} title={formatDateTime(chat.updatedAt)}>
            {age(chat.updatedAt, props.now)}
          </time>
        </span>
      </span>
    </div>
  )
}
