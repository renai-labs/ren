export * as Agents from "./agents.js"

import type { AgentInfo } from "@ren/client"
import { pickerPageSize } from "./pagination.js"
import type { Runtime } from "./runtime.js"

export const listOptions = (api: Runtime.Context["api"], spaceId: string) =>
  api.agent.list.queryOptions({ spaceId, page: 1, pageSize: pickerPageSize })

export const source = (agent: AgentInfo, spaceId: string, spaceName: (id: string) => string | undefined) => {
  if (agent.ownerSpaceId === null) return "Built-in"
  if (agent.ownerSpaceId === spaceId) return "This space"
  return `Shared from ${spaceName(agent.ownerSpaceId) ?? "another space"}`
}

export const archiveConfirmation = (agent: AgentInfo) => ({
  title: `Archive “${agent.name}”?`,
  description:
    "Schedules that use it pause, webhook requests to it are skipped, open chats fall back to Ren, it leaves the factory.",
  action: "Archive",
})
