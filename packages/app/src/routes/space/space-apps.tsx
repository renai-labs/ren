import { useState } from "react"
import type { AppProfileInfo } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { AccountActions } from "@/components/ren/account-actions"
import { AddAppDialog } from "@/components/ren/add-app-dialog"
import { AccountList, AppSheet } from "@/components/ren/app-list"
import { AppsTable } from "@/components/ren/apps-table"
import { SkeletonRows } from "@/components/ren/page"
import { ProfileDialog, type ProfileTarget } from "@/components/ren/profile-dialog"
import { useCatalog } from "@/hooks/use-catalog"
import { api, errorMessage, profileQueries } from "@/lib/api"
import { caption, source } from "@/lib/apps"
import { useSpace } from "@/routes/space/use-space"

function useSpaceApps() {
  const space = useSpace()
  const catalog = useCatalog()
  const reach = useQuery({
    ...api["app-profile-reach"].space.profiles.queryOptions({ id: space.id }),
    refetchOnWindowFocus: "always",
  })
  const access = useMutation({ ...api["app-profile"].access.mutationOptions(), meta: { invalidates: profileQueries } })
  const [opened, setOpened] = useState<string>()
  const [profile, setProfile] = useState<ProfileTarget>()
  const reached = reach.data?.profiles ?? []
  const byApp = Map.groupBy(reached, (each) => each.appId)
  const app = opened ? catalog.appOf(opened) : undefined
  const here: ReadonlyArray<AppProfileInfo> = app ? (byApp.get(app.id) ?? []) : []
  const from = { spaceId: space.id, name: space.name, members: space.memberCount, private: space.kind === "private" }
  const change = (input: { id: string; add?: string[]; remove?: string[] }, title: string) =>
    access.mutateAsync(input, { onError: (error) => toast.error(title, { description: errorMessage(error) }) })
  return {
    space,
    loading: reach.isPending || catalog.loading,
    hidden: reach.error?.name === "NotFoundError" || reach.error?.name === "ForbiddenError",
    from,
    byApp,
    rows: [...byApp].flatMap(([appId, profiles]) => {
      const each = catalog.appOf(appId)
      return each
        ? [{ app: each, profiles, usedIn: [...new Set(profiles.map((one) => source(one, space.id)))].join(", ") }]
        : []
    }),
    app,
    here,
    elsewhere: app
      ? catalog.profilesOf(app.id).filter((each) => each.kind === "shared" && !here.some((own) => own.id === each.id))
      : [],
    open: setOpened,
    profile,
    setProfile,
    remove: (profileId: string) => change({ id: profileId, remove: [space.id] }, "Couldn’t remove the account"),
    addHere: (profileId: string) => change({ id: profileId, add: [space.id] }, "Couldn’t add the account"),
  }
}

export function SpaceAppsTab() {
  const page = useSpaceApps()
  const space = page.space
  const app = page.app
  if (page.hidden)
    return (
      <p className="rounded-xl border py-8 text-center text-sm text-muted-foreground">
        Only members of this space see its apps.
      </p>
    )
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <AddAppDialog
          space={space}
          added={new Set(page.byApp.keys())}
          onAdded={(added) => page.setProfile({ appId: added.app.id, profileId: added.profileId, from: page.from })}
        />
      </div>
      {page.loading ? (
        <SkeletonRows count={3} />
      ) : (
        <AppsTable
          rows={page.rows}
          empty="No apps"
          onOpen={page.open}
          onNew={(appId) => page.setProfile({ appId, from: page.from })}
        />
      )}
      <AppSheet app={app} onClose={() => page.open(undefined)}>
        {app ? (
          <>
            <AccountList
              title="Accounts"
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => page.setProfile({ appId: app.id, from: page.from })}
                >
                  <IconPlus />
                  New account
                </Button>
              }
              profiles={page.here}
              caption={(each) => caption(each, space.id)}
              onOpen={(each) => page.setProfile({ appId: each.appId, profileId: each.id, from: page.from, edit: true })}
              action={(each) => (
                <AccountActions
                  profile={each}
                  onOpen={() => page.setProfile({ appId: each.appId, profileId: each.id, from: page.from })}
                  onRemove={
                    each.spaces.some((listed) => listed.id === space.id) ? () => page.remove(each.id) : undefined
                  }
                />
              )}
            />
            <AccountList
              title="Other accounts in your org"
              profiles={page.elsewhere}
              caption={(each) => source(each, space.id)}
              action={(each) => (
                <Button variant="outline" size="sm" onClick={() => void page.addHere(each.id)}>
                  Use here
                </Button>
              )}
            />
          </>
        ) : null}
      </AppSheet>
      {page.profile ? <ProfileDialog {...page.profile} onClose={() => page.setProfile(undefined)} /> : null}
    </div>
  )
}
