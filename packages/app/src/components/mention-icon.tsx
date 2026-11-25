import type { ReactNode } from "react"
import type { Mentions } from "@ren/chat"
import { IconGitBranch, IconMessage, IconSparkles, IconSubtask } from "@tabler/icons-react"
import { IconAgent } from "@ren/ui/heroicons"

// oxlint-disable-next-line ren/no-comments -- One icon per kind of mention, shared by the mention menu, the composer and the sent message, so a task looks like a task everywhere. A chat's chip in @ren/ui uses the same IconMessage.
export const TaskIcon = IconSubtask

export const ChatIcon = IconMessage

export const AgentIcon = IconAgent

export const RepositoryIcon = IconGitBranch

export const SkillIcon = IconSparkles

export const mentionIcons: Partial<Record<Mentions.Kind, ReactNode>> = {
  task: <TaskIcon />,
  chat: <ChatIcon />,
  repository: <RepositoryIcon />,
  agent: <AgentIcon />,
  "ren-agent": <AgentIcon />,
  skill: <SkillIcon />,
}
