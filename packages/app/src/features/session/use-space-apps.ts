import type { AppProfileInfo } from "@ren/client"
import { useQuery } from "@tanstack/react-query"
import type { ProfileTarget } from "../../components/profile-dialog.js"
import { gaps, statusOf, type Status } from "../../lib/apps.js"
import { useApps } from "../../lib/use-app.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { RouterContext } from "../../lib/router-context.js"

export const isReady = (status: Status) => status === "connected" || status === "credits"

export function useSpaceApps(spaceId: string | undefined, appIds: ReadonlyArray<string> = []) {
  const { api } = RouterContext.useRouterContext()
  const space = useSpaces().space(spaceId)
  const reach = useQuery({
    ...api["app-profile-reach"].space.profiles.queryOptions({ id: spaceId ?? "" }),
    enabled: spaceId !== undefined,
    refetchOnWindowFocus: "always",
    retry: false,
  })
  const profiles = reach.data?.profiles ?? []
  const apps = useApps([...profiles.map((profile) => profile.appId), ...appIds])
  const here = (appId: string) => profiles.filter((profile) => profile.appId === appId)
  return {
    pending: (spaceId !== undefined && reach.isPending) || apps.pending,
    profiles,
    here,
    app: apps.of,
    status: (appId: string, options?: { managed: boolean }): Status => {
      const app = apps.of(appId)
      if (app) return statusOf(app, here(appId))
      return here(appId).length === 0 && options?.managed ? "credits" : statusOf({ mcps: null }, here(appId))
    },
    from: space && {
      spaceId: space.id,
      name: space.name,
      members: space.memberCount,
      private: space.kind === "private",
    },
    refresh: async (appId: string) => {
      const fresh = (await reach.refetch()).data?.profiles.filter((profile) => profile.appId === appId) ?? []
      return statusOf(apps.of(appId) ?? { mcps: null }, fresh)
    },
  }
}

export const connectTarget = (
  input: { appId: string; status: Status; here: ReadonlyArray<AppProfileInfo> },
  from: NonNullable<ProfileTarget["from"]>,
): ProfileTarget => {
  if (input.status === "expired")
    return {
      appId: input.appId,
      profileId: input.here.find((profile) => profile.items.some((item) => item.status === "reconnect"))?.id,
      from,
    }
  if (input.status === "credits")
    return { appId: input.appId, profileId: input.here.find((profile) => gaps(profile).length > 0)?.id, from }
  return { appId: input.appId, from }
}
