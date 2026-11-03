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
import { useSyncExternalStore } from "react"

export const inboxColumns = ["Chat", "Agent", "Started by", "From", "Last activity"]

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
