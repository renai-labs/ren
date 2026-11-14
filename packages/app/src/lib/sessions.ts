import type { SessionListInput } from "@ren/client"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import {
  IconBrandGithubFilled,
  IconBrandSlack,
  IconClock,
  IconMessageCircle,
  IconSubtask,
  IconTicket,
  IconWebhook,
} from "@tabler/icons-react"
import { infiniteQueryOptions } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"
import { sessionKeys } from "./chat.js"
import type { Runtime } from "./runtime.js"

const untitled = "New chat"

const placeholderTitle = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

export function sessionTitle(title: string | null | undefined, fallback = untitled) {
  if (!title || placeholderTitle.test(title)) return fallback
  return title
}

const sidebarPageSize = 30

export type SessionFilter = Omit<SessionListInput, "page" | "pageSize">

export const inboxColumns = ["Chat", "Agent", "Started by", "From", "Last activity"]

export const ownChats = (userId: string): SessionFilter => ({ createdBy: [userId] })

export const sidebarSessionsOptions = (client: Runtime.Context["client"], filter: SessionFilter = {}) =>
  infiniteQueryOptions({
    queryKey: sessionKeys.infinitePage({ ...filter, pageSize: sidebarPageSize }),
    queryFn: (context) =>
      client.session.list(
        { ...filter, page: context.pageParam, pageSize: sidebarPageSize },
        { signal: context.signal },
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    staleTime: 30_000,
    refetchInterval: 10_000,
  })

export const origins = [
  { value: "chat", label: "Chat", icon: IconMessageCircle },
  { value: "task", label: "Task", icon: IconSubtask },
  { value: "schedule", label: "Schedule", icon: IconClock },
  { value: "slack", label: "Slack", icon: IconBrandSlack },
  { value: "linear", label: "Linear", icon: IconTicket },
  { value: "github", label: "GitHub", icon: IconBrandGithubFilled },
  { value: "webhook", label: "Webhook", icon: IconWebhook },
] as const

type Origin = (typeof origins)[number]["value"]

export const isOrigin = (value: string): value is Origin => origins.some((origin) => origin.value === value)

export function useChatAttention(sessionId: string) {
  const atoms = ChatReact.useAtoms()
  return useSyncExternalStore(
    (listener) => atoms.attention.subscribe(() => queueMicrotask(listener)),
    () => atoms.attention.read(Session.ID.make(sessionId)),
  )
}
