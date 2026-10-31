import { getRouteApi } from "@tanstack/react-router"
import { useState } from "react"
import type { AppProfileInfo } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { IconPlus } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Button } from "@ren/ui/button"
import { AccountActions } from "../../components/account-actions.js"
import { AddAppDialog } from "../../components/add-app-dialog.js"
import { AccountList, AppSheet } from "../../components/app-list.js"
import { AppsTable } from "../../components/apps-table.js"
import { SkeletonRows } from "../../components/page.js"
import { ProfileDialog, type ProfileTarget } from "../../components/profile-dialog.js"
import { useCatalog } from "../../lib/use-catalog.js"
import { errorMessage } from "../../lib/errors.js"
import { caption, source } from "../../lib/apps.js"
import { useSpace } from "./use-space.js"
import { RouterContext } from "../../lib/router-context.js"

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/apps")

const hiddenBy = (error: Error | null) => error?.name === "NotFoundError" || error?.name === "ForbiddenError"

function SpaceAppAccounts(props: {
  spaceId: string
  here: ReadonlyArray<AppProfileInfo>
  elsewhere: ReadonlyArray<AppProfileInfo>
  onNew: () => void
  onOpen: (profile: AppProfileInfo) => void
  onEdit: (profile: AppProfileInfo) => void
  onRemove: (profileId: string) => Promise<unknown>
  onAddHere: (profileId: string) => Promise<unknown>
}) {
  return (
    <>
      <AccountList
        title="Accounts"
        actions={
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={props.onNew}>
            <IconPlus />
            New account
          </Button>
        }
        profiles={props.here}
        caption={(each) => caption(each, props.spaceId)}
        onOpen={props.onEdit}
        action={(each) => (
          <AccountActions
            profile={each}
            onOpen={() => props.onOpen(each)}
            onRemove={
              each.spaces.some((listed) => listed.id === props.spaceId) ? () => props.onRemove(each.id) : undefined
            }
          />
        )}
      />
      <AccountList
        title="Other accounts in your org"
        profiles={props.elsewhere}
        caption={(each) => source(each, props.spaceId)}
        action={(each) => (
          <Button variant="outline" size="sm" onClick={() => void props.onAddHere(each.id)}>
            Use here
          </Button>
        )}
      />
    </>
  )
}

export function SpaceAppsTab() {
  const { api } = RouterContext.useRouterContext()
  const space = useSpace()
  const catalog = useCatalog()
  const reach = useQuery({
    ...api["app-profile-reach"].space.profiles.queryOptions({ id: space.id }),
    refetchOnWindowFocus: "always",
  })
  const access = useMutation(api["app-profile"].access.mutationOptions())
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const opened = search.app
  const setOpened = (app: string | undefined) => void navigate({ search: (previous) => ({ ...previous, app }) })
  const [profile, setProfile] = useState<ProfileTarget>()
  const reached = reach.data?.profiles ?? []
  const byApp = Map.groupBy(reached, (each) => each.appId)
  const app = opened ? catalog.appOf(opened) : undefined
  const here: ReadonlyArray<AppProfileInfo> = app ? (byApp.get(app.id) ?? []) : []
  const from = { spaceId: space.id, name: space.name, members: space.memberCount, private: space.kind === "private" }
  const change = (input: { id: string; add?: string[]; remove?: string[] }, title: string) =>
    access.mutateAsync(input, { onError: (error) => toast.error(title, { description: errorMessage(error) }) })
  const rows = [...byApp].flatMap(([appId, profiles]) => {
    const each = catalog.appOf(appId)
    return each
      ? [{ app: each, profiles, usedIn: [...new Set(profiles.map((one) => source(one, space.id)))].join(", ") }]
      : []
  })
  if (hiddenBy(reach.error))
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
          added={new Set(byApp.keys())}
          onAdded={(added) => setProfile({ appId: added.app.id, profileId: added.profileId, from })}
        />
      </div>
      {reach.isPending || catalog.loading ? (
        <SkeletonRows count={3} />
      ) : (
        <AppsTable rows={rows} empty="No apps" onOpen={setOpened} onNew={(appId) => setProfile({ appId, from })} />
      )}
      <AppSheet app={app} onClose={() => setOpened(undefined)}>
        {app ? (
          <SpaceAppAccounts
            spaceId={space.id}
            here={here}
            elsewhere={catalog
              .profilesOf(app.id)
              .filter((each) => each.kind === "shared" && !here.some((own) => own.id === each.id))}
            onNew={() => setProfile({ appId: app.id, from })}
            onOpen={(each) => setProfile({ appId: each.appId, profileId: each.id, from })}
            onEdit={(each) => setProfile({ appId: each.appId, profileId: each.id, from, edit: true })}
            onRemove={(profileId) => change({ id: profileId, remove: [space.id] }, "Couldn’t remove the account")}
            onAddHere={(profileId) => change({ id: profileId, add: [space.id] }, "Couldn’t add the account")}
          />
        ) : null}
      </AppSheet>
      {profile ? <ProfileDialog {...profile} onClose={() => setProfile(undefined)} /> : null}
    </div>
  )
}
