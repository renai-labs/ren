export * as ChannelMappingData from "./channel-mapping-data.js"

import type { ChannelMappingInfo, ChannelTriggerSetting } from "@ren/client"
import { Pagination } from "@ren/schema/pagination"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pages } from "../../lib/pages.js"
import { RouterContext } from "../../lib/router-context.js"

export const page = { page: 1, pageSize: Pagination.maximumPageSize }

export interface Settings {
  readonly agentId?: string
  readonly fallback?: boolean
  readonly fallbackUserId?: string
  readonly triggers: ReadonlyArray<ChannelTriggerSetting>
}

export const settingsOf = (mapping: ChannelMappingInfo): Settings => ({
  ...(mapping.agent && { agentId: mapping.agent.id }),
  fallback: mapping.fallback,
  ...(mapping.fallbackUser && { fallbackUserId: mapping.fallbackUser.id }),
  triggers: mapping.triggers,
})

export function useMappings(installId: string) {
  const context = RouterContext.useRouterContext()
  return useQuery(
    Pages.all((number) => context.api["channel-mapping"].list.queryOptions({ ...page, page: number, installId })),
  )
}

export function usePlaces(installId: string, options: { readonly enabled: boolean }) {
  const context = RouterContext.useRouterContext()
  return useQuery({
    ...Pages.all((number) =>
      context.api["channel-connect"]["channel-place"].list.queryOptions({ ...page, page: number, installId }),
    ),
    enabled: options.enabled,
  })
}

export function useSpaces() {
  const context = RouterContext.useRouterContext()
  return useQuery(Pages.all((number) => context.api.space.list.queryOptions({ ...page, page: number, joined: true })))
}

export function useChanges() {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: context.api["channel-mapping"].list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: context.api["channel-connect"]["channel-place"].list.queryKey() }),
    ])
  const create = useMutation({ ...context.api["channel-mapping"].create.mutationOptions(), onSuccess: refresh })
  const remove = useMutation({ ...context.api["channel-mapping"].remove.mutationOptions(), onSuccess: refresh })
  return {
    pending: create.isPending || remove.isPending,
    creating: create.isPending,
    save: (
      target: { readonly installId: string; readonly place: string; readonly spaceId: string },
      settings: Settings,
      options: { readonly onSuccess?: () => void; readonly onError?: () => void } = {},
    ) => create.mutate({ ...target, ...settings, triggers: [...settings.triggers] }, options),
    remove: (id: string, options: { readonly onSuccess?: () => void } = {}) => remove.mutate({ id }, options),
  }
}

export type Changes = ReturnType<typeof useChanges>
