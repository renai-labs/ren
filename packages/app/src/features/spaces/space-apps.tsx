import { getRouteApi } from "@tanstack/react-router"
import { useState } from "react"
import type { AppProfileInfo } from "@ren/client"
import { useQuery } from "@tanstack/react-query"
import { IconPlus, IconUserPlus } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { AddAppDialog } from "../../components/add-app-dialog.js"
import { AccountList, AppSheet } from "../../components/app-list.js"
import { AppsTable } from "../../components/apps-table.js"
import { PageActions, TableSample, useShapeId } from "../../components/page.js"
import { LoadMore } from "../../components/load-more.js"
import { useShown } from "../../lib/use-shown.js"
import { Loading } from "@ren/ui/loading"
import { ProfileDialog, type ProfileTarget } from "../../components/profile-dialog.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { Search } from "../../lib/search.js"
import { useApp, useApps } from "../../lib/use-app.js"
import { source } from "../../lib/apps.js"
import { useSpace } from "./use-space.js"
import { RouterContext } from "../../lib/router-context.js"

const route = getRouteApi("/_authed/_shell/spaces/$spaceId/apps")

const hiddenBy = (error: Error | null) => error?.name === "NotFoundError" || error?.name === "ForbiddenError"

function AddAccount(props: { onNew: () => void; onExisting: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" />}>
        <IconPlus data-icon="inline-start" />
        Add account
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={props.onNew}>
            <IconPlus />
            New account
          </DropdownMenuItem>
          <DropdownMenuItem onClick={props.onExisting}>
            <IconUserPlus />
            Use existing account
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const opened = search.app
  const setOpened = (app: string | undefined) => void navigate({ search: (previous) => ({ ...previous, app }) })
  const [profile, setProfile] = useState<ProfileTarget>()
  const [query, setQuery] = useState("")
  const reached = reach.data?.profiles ?? []
  const byApp = Map.groupBy(reached, (each) => each.appId)
  const catalog = useApps([...byApp.keys()])
  const app = useApp(opened).app
  const here: ReadonlyArray<AppProfileInfo> = app ? (byApp.get(app.id) ?? []) : []
  const from = { spaceId: space.id, name: space.name, members: space.memberCount, private: space.kind === "private" }
  const rows = [...byApp].flatMap(([appId, profiles]) => {
    const each = catalog.of(appId)
    return each
      ? [{ app: each, profiles, usedIn: [...new Set(profiles.map((one) => source(one, space.id)))].join(", ") }]
      : []
  })
  const shown = useShown(rows.filter((row) => Search.matches(query, row.app.name, row.app.description, row.usedIn)))
  if (hiddenBy(reach.error))
    return (
      <p className="rounded-xl border py-8 text-center text-sm text-muted-foreground">
        Only members of this space see its apps.
      </p>
    )
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageActions>
        <ToolbarSearch label="Search apps" value={query} onChange={setQuery} />
        <AddAppDialog
          space={space}
          added={new Set(byApp.keys())}
          onAdded={(added) => setProfile({ appId: added.app.id, profileId: added.profileId, from })}
        />
      </PageActions>
      <Loading id={shapeId} loading={reach.isPending || catalog.pending} label="Loading apps">
        {reach.isPending || catalog.pending ? (
          <TableSample columns={["App", "Used in", "Status", ""]} count={3} />
        ) : (
          <AppsTable
            rows={shown.items}
            empty={Search.empty(query, "No apps")}
            onOpen={setOpened}
            onNew={(appId) => setProfile({ appId, from })}
          />
        )}
      </Loading>
      <LoadMore more={shown.more} onMore={shown.next} />
      <AppSheet app={app} onClose={() => setOpened(undefined)}>
        {app ? (
          <AccountList
            title="Accounts"
            app={app}
            actions={
              <AddAccount
                onNew={() => setProfile({ appId: app.id, from })}
                onExisting={() => setProfile({ appId: app.id, from, existing: true })}
              />
            }
            profiles={here}
            empty={`No ${app.name} accounts in ${space.name} yet`}
            onOpen={(each) => setProfile({ appId: each.appId, profileId: each.id, from, edit: true })}
          />
        ) : null}
      </AppSheet>
      {profile ? <ProfileDialog {...profile} onClose={() => setProfile(undefined)} /> : null}
    </div>
  )
}
