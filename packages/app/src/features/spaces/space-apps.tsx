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
import { PageFooter, TableSample, useShapeId } from "../../components/page.js"
import { ListPagination } from "../../components/list-pagination.js"
import { currentPage, pageCount, pageSize } from "../../lib/pagination.js"
import { Loading } from "@ren/ui/loading"
import { ProfileDialog, type ProfileTarget } from "../../components/profile-dialog.js"
import { useApp, useApps } from "../../lib/use-app.js"
import { useAppProfiles } from "../../lib/use-app-profiles.js"
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
  const shapeId = useShapeId("apps")
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
  const catalog = useApps([...byApp.keys()])
  const app = useApp(opened).app
  const elsewhere = useAppProfiles(app ? [app.id] : [])
  const here: ReadonlyArray<AppProfileInfo> = app ? (byApp.get(app.id) ?? []) : []
  const from = { spaceId: space.id, name: space.name, members: space.memberCount, private: space.kind === "private" }
  const change = (input: { id: string; add?: string[]; remove?: string[] }, title: string) =>
    access.mutateAsync(input, { onError: (error) => toast.error(title, { description: errorMessage(error) }) })
  const rows = [...byApp].flatMap(([appId, profiles]) => {
    const each = catalog.of(appId)
    return each
      ? [{ app: each, profiles, usedIn: [...new Set(profiles.map((one) => source(one, space.id)))].join(", ") }]
      : []
  })
  const page = Math.min(currentPage(search), pageCount(rows.length, pageSize))
  if (hiddenBy(reach.error))
    return (
      <AppsTable
        rows={[]}
        empty="Only members of this space see its apps."
        onOpen={setOpened}
        onNew={(appId) => setProfile({ appId, from })}
      />
    )
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex justify-end">
        <AddAppDialog
          space={space}
          added={new Set(byApp.keys())}
          onAdded={(added) => setProfile({ appId: added.app.id, profileId: added.profileId, from })}
        />
      </div>
      <Loading id={shapeId} loading={reach.isPending || catalog.pending} label="Loading apps">
        {reach.isPending || catalog.pending ? (
          <TableSample columns={["App", "Used in", "Status", ""]} count={3} />
        ) : (
          <AppsTable
            rows={rows.slice((page - 1) * pageSize, page * pageSize)}
            empty="No apps"
            onOpen={setOpened}
            onNew={(appId) => setProfile({ appId, from })}
          />
        )}
      </Loading>
      <PageFooter>
        <ListPagination page={page} pageSize={pageSize} total={rows.length} noun="app" />
      </PageFooter>
      <AppSheet app={app} onClose={() => setOpened(undefined)}>
        {app ? (
          <SpaceAppAccounts
            spaceId={space.id}
            here={here}
            elsewhere={elsewhere
              .of(app.id)
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
