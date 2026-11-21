import type { AppProfileInfo } from "@ren/client"
import { SpaceApps } from "@ren/client/react"
import type { ProfileTarget } from "../../components/profile-dialog.js"
import { gaps, type Status } from "../../lib/apps.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { RouterContext } from "../../lib/router-context.js"

export function useSpaceApps(spaceId: string | undefined, appIds: ReadonlyArray<string> = []) {
  const { api } = RouterContext.useRouterContext()
  return SpaceApps.useSpace(api, { spaceId, space: useSpaces().space(spaceId), appIds })
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
