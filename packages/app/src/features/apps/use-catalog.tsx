import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ProfileDialog, type ProfileTarget } from "../../components/profile-dialog.js"
import type { Added } from "../../components/add-to-space.js"
import { AppRegistryPages } from "../../lib/app-registry.js"
import { fromRegistry } from "../../lib/apps.js"
import { RouterContext } from "../../lib/router-context.js"
import { useSpaces } from "../../lib/use-spaces.js"

export function useRegistryApps(slugs: ReadonlyArray<string>) {
  const { api } = RouterContext.useRouterContext()
  const listed = useQuery({ ...AppRegistryPages.bySlugs(api, slugs), enabled: slugs.length > 0 })
  const found = new Map((listed.data?.items ?? []).map((app) => [app.slug, fromRegistry(app)]))
  return {
    pending: slugs.length > 0 && listed.isPending,
    of: (slug: string) => found.get(slug),
  }
}

export function useAddedProfile() {
  const spaces = useSpaces()
  const [profile, setProfile] = useState<ProfileTarget>()
  const added: Added = (added) =>
    setProfile({
      appId: added.app.id,
      profileId: added.profileId,
      from: {
        spaceId: added.space.id,
        name: added.space.name,
        members: spaces.space(added.space.id)?.memberCount ?? 1,
      },
    })
  return {
    added,
    dialog: profile ? <ProfileDialog {...profile} onClose={() => setProfile(undefined)} /> : null,
  }
}
