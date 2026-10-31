export * as Channels from "./channels.js"

import type { ChannelMappingInfo, ChannelProvider } from "@ren/client"
import { pickerPageSize } from "./pagination.js"
import type { Runtime } from "./runtime.js"

export type Provider = ChannelProvider

export interface Info {
  readonly id: Provider
  readonly title: string
  readonly noun: string
  readonly plural: string
  readonly prefix: string
}

export const byId: Readonly<Record<Provider, Info>> = {
  github: { id: "github", title: "GitHub", noun: "repo", plural: "repos", prefix: "" },
  slack: { id: "slack", title: "Slack", noun: "channel", plural: "channels", prefix: "#" },
  linear: { id: "linear", title: "Linear", noun: "project", plural: "projects", prefix: "" },
}

export const sections: ReadonlyArray<{
  readonly title: string
  readonly description: string
  readonly providers: ReadonlyArray<Provider>
}> = [
  { title: "Git providers", description: "Let Ren work in your repositories", providers: ["github"] },
  {
    title: "Communication",
    description: "Ren can join your team’s chats and work alongside everyone",
    providers: ["slack"],
  },
  { title: "Task management", description: "Turn issues into pull requests", providers: ["linear"] },
]

export const all = { page: 1, pageSize: pickerPageSize }

export const installsOptions = (api: Runtime.Context["api"]) =>
  api["channel-install"].list.queryOptions({ page: 1, pageSize: 50 })

export const placesOptions = (api: Runtime.Context["api"], installId: string) =>
  api["channel-connect"]["channel-place"].list.queryOptions({ ...all, installId })

export const label = (provider: Provider, name: string) => `${byId[provider].prefix}${name}`

export const settingsOf = (mapping: ChannelMappingInfo) => ({
  installId: mapping.installId,
  place: mapping.place,
  spaceId: mapping.space.id,
  ...(mapping.agent && { agentId: mapping.agent.id }),
  fallback: mapping.fallback,
  ...(mapping.fallbackUser && { fallbackUserId: mapping.fallbackUser.id }),
  triggers: [...mapping.triggers],
})
