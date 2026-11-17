import {
  IconBrandGithubFilled,
  IconBrandSlack,
  IconClock,
  IconMessageCircle,
  IconSubtask,
  IconTicket,
  IconWebhook,
} from "@tabler/icons-react"
import { ChatFilters } from "@ren/client/react"

export const inboxColumns = ["Chat", "Agent", "Started by", "From", "Last activity"]

const originIcons = {
  chat: IconMessageCircle,
  task: IconSubtask,
  schedule: IconClock,
  slack: IconBrandSlack,
  linear: IconTicket,
  github: IconBrandGithubFilled,
  webhook: IconWebhook,
} as const

export const origins = ChatFilters.origins.map((origin) => ({
  value: origin.value,
  label: origin.label,
  icon: originIcons[origin.value],
}))
