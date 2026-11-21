import type { AppProfileInfo } from "@ren/client"
import { listsSpace, statusOf, type CatalogApp, type Status } from "./apps.js"
import { useApps } from "./use-app.js"
import { useAppProfiles } from "./use-app-profiles.js"
import { useMe } from "./use-me.js"

export type BundlePart = {
  readonly app: CatalogApp
  readonly here: ReadonlyArray<AppProfileInfo>
  readonly status: Status | "absent"
}

export function useBundleParts(
  bundle: Pick<CatalogApp, "dependsOn">,
  place: { readonly spaceId: string; readonly private: boolean },
) {
  const me = useMe().user.id
  const apps = useApps(bundle.dependsOn)
  const found = bundle.dependsOn.flatMap((slug) => {
    const app = apps.of(slug)
    return app ? [app] : []
  })
  const profiles = useAppProfiles(found.map((app) => app.id))
  const reaches = (profile: AppProfileInfo) =>
    profile.kind === "private" ? place.private && profile.userId === me : listsSpace(profile, place.spaceId)
  const parts = found.map((app): BundlePart => {
    const here = profiles.of(app.id).filter(reaches)
    return { app, here, status: here.length === 0 ? "absent" : statusOf(app, here) }
  })
  return { pending: apps.pending || profiles.pending, parts }
}
