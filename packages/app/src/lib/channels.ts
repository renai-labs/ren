export * as Channels from "./channels.js"

import type { ChannelMappingInfo, ChannelPlaceInfo, ChannelProvider, SpaceInfo, SpaceMemberInfo } from "@ren/client"
import { queryOptions } from "@tanstack/react-query"
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

const mappingsKey = (installId: string) => ["channel-mapping", "all", installId] as const

export const mappingsOptions = (client: Runtime.Context["client"], installId: string) =>
  queryOptions({
    queryKey: mappingsKey(installId),
    queryFn: async (context) => {
      const items: ChannelMappingInfo[] = []
      for (let page = 1; ; page++) {
        // oxlint-disable-next-line no-await-in-loop -- fetch pages in order until the complete mapping list is loaded
        const result = await client["channel-mapping"].list(
          { installId, page, pageSize: pickerPageSize },
          { signal: context.signal },
        )
        items.push(...result.items)
        if (page * result.pageSize >= result.total || result.items.length === 0) return items
      }
    },
  })

const availablePlacesKey = (installId: string) => ["channel-connect", "all-places", installId] as const

export const availablePlacesOptions = (client: Runtime.Context["client"], installId: string) =>
  queryOptions({
    queryKey: availablePlacesKey(installId),
    queryFn: async (context) => {
      const items: ChannelPlaceInfo[] = []
      for (let page = 1; ; page++) {
        // oxlint-disable-next-line no-await-in-loop -- fetch every provider page so the picker does not silently truncate
        const result = await client["channel-connect"]["channel-place"].list(
          { installId, page, pageSize: pickerPageSize },
          { signal: context.signal },
        )
        items.push(...result.items)
        if (page * result.pageSize >= result.total || result.items.length === 0) return items
      }
    },
  })

const spacesKey = () => ["space", "channel-picker"] as const

export const spacesOptions = (client: Runtime.Context["client"]) =>
  queryOptions({
    queryKey: spacesKey(),
    queryFn: async (context) => {
      const items: SpaceInfo[] = []
      for (let page = 1; ; page++) {
        // oxlint-disable-next-line no-await-in-loop -- pages fetched in order until total reached
        const result = await client.space.list({ page, pageSize: pickerPageSize }, { signal: context.signal })
        items.push(...result.items)
        if (page * result.pageSize >= result.total || result.items.length === 0) return items
      }
    },
  })

const membersKey = (spaceId: string) => ["space-member", "channel-picker", spaceId] as const

export const membersOptions = (client: Runtime.Context["client"], spaceId: string) =>
  queryOptions({
    queryKey: membersKey(spaceId),
    enabled: spaceId !== "",
    queryFn: async (context) => {
      const items: SpaceMemberInfo[] = []
      for (let page = 1; ; page++) {
        // oxlint-disable-next-line no-await-in-loop -- pages fetched in order until total reached
        const result = await client["space-member"].list(
          { spaceId, page, pageSize: pickerPageSize },
          { signal: context.signal },
        )
        items.push(...result.items)
        if (page * result.pageSize >= result.total || result.items.length === 0) return items
      }
    },
  })

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
