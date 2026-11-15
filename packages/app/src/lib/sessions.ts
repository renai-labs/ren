import {
  IconBrandGithubFilled,
  IconBrandSlack,
  IconClock,
  IconMessageCircle,
  IconSubtask,
  IconTicket,
  IconWebhook,
} from "@tabler/icons-react"

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
