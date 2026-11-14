import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import type { AppProfileInfo } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { IconPlus, IconTrash, IconUserPlus } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { toast } from "@ren/ui/sonner"
import { Tabs } from "@ren/ui/tabs"
import { AddAppDialog } from "../../components/add-app-dialog.js"
import { AccountList, AppGrid, AppRow, AppSheet } from "../../components/app-list.js"
import { CustomAppDialog } from "../../components/custom-app-dialog.js"
import { EmptyState } from "../../components/empty-state.js"
import { AppsTable } from "../../components/apps-table.js"
import { PageActions, PageTabs, PageTabsList, PageTabsTrigger, TableSample, useShapeId } from "../../components/page.js"
import { LoadMore } from "../../components/load-more.js"
import { afterRemoval } from "../../components/space-removal.js"
import type { RowMenuItem } from "../../components/row-menu.js"
import { useShown } from "../../lib/use-shown.js"
import { Loading } from "@ren/ui/loading"
import { ProfileDialog, type ProfileTarget } from "../../components/profile-dialog.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { Search } from "../../lib/search.js"
import { errorMessage } from "../../lib/errors.js"
import { useApp, useApps } from "../../lib/use-app.js"
import { fromApp, source, type CatalogApp } from "../../lib/apps.js"
import { pickerPageSize } from "../../lib/pagination.js"
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

function NoApps(props: { query: string; space: string; onAdd: () => void }) {
  if (props.query.trim()) return Search.empty(props.query, "No apps")
  return (
    <span className="flex flex-col items-center gap-3">
      No apps in {props.space} yet.
      <Button variant="outline" size="sm" onClick={props.onAdd}>
        <IconPlus data-icon="inline-start" />
        Add app
      </Button>
    </span>
  )
}

const names = (profiles: ReadonlyArray<AppProfileInfo>) => profiles.map((profile) => `“${profile.name}”`).join(", ")

function useRemoveApp(space: { id: string; name: string; kind: string; membershipId: string | null }) {
  const { api } = RouterContext.useRouterContext()
  const access = useMutation(api["app-profile"].access.mutationOptions())
  const shape = (() => {
    if (space.kind === "private") return "ownPrivate"
    return space.membershipId ? "joined" : "shared"
  })()
  return (row: { app: CatalogApp; profiles: ReadonlyArray<AppProfileInfo> }): RowMenuItem | undefined => {
    const app = row.app
    const listed = row.profiles.filter(
      (profile) =>
        profile.kind === "shared" && !profile.allSpaces && profile.spaces.some((each) => each.id === space.id),
    )
    const removable = listed.filter((profile) => profile.canRemove.includes(shape))
    if (removable.length === 0) return undefined
    const locked = listed.filter((profile) => !profile.canRemove.includes(shape))
    const everywhere = row.profiles.filter((profile) => profile.allSpaces)
    const notes = [
      everywhere.length > 0
        ? `${names(everywhere)} ${everywhere.length === 1 ? "stays because it is" : "stay because they are"} in every space.`
        : "",
      locked.length > 0 ? `Only an admin can remove ${names(locked)} from ${space.name}.` : "",
    ].filter(Boolean)
    const kept = everywhere.length > 0 || locked.length > 0
    return {
      label: `Remove from ${space.name}`,
      icon: IconTrash,
      confirm: {
        title: `Remove ${app.name} from ${space.name}?`,
        description: [
          kept ? `${space.name} stops using ${names(removable)}.` : `The agent in ${space.name} loses ${app.name}.`,
          "Accounts with a sign-in are kept.",
          ...notes,
        ].join(" "),
        action: `Remove ${app.name}`,
      },
      onSelect: () =>
        Promise.all(removable.map((profile) => access.mutateAsync({ id: profile.id, remove: [space.id] }))).then(
          (infos) => {
            const settings = infos.filter((info) => afterRemoval(info) === "kept")
            const description = [
              settings.length > 0 ? `Find ${names(settings)} in Settings → Credentials.` : "",
              ...notes,
            ].filter(Boolean)
            toast.success(
              `${app.name} removed from ${space.name}`,
              description.length > 0 ? { description: description.join(" ") } : {},
            )
          },
          (error: unknown) =>
            toast.error(`Couldn’t remove ${app.name} from ${space.name}`, { description: errorMessage(error) }),
        ),
    }
  }
}

function CustomApps(props: { space: { id: string; name: string }; query: string }) {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const shapeId = useShapeId("custom-apps")
  const [creating, setCreating] = useState(false)
  const listed = useQuery(api.app.list.queryOptions({ spaceId: props.space.id, page: 1, pageSize: pickerPageSize }))
  const owned = (listed.data?.items ?? [])
    .filter((app) => app.ownerSpaceId === props.space.id)
    .map(fromApp)
    .filter((app) => Search.matches(props.query, app.name, app.description))
  return (
    <>
      {!listed.isPending && owned.length === 0 ? (
        <EmptyState
          action={
            props.query.trim() ? undefined : (
              <Button variant="outline" onClick={() => setCreating(true)}>
                <IconPlus data-icon="inline-start" />
                Create app
              </Button>
            )
          }
        >
          {Search.empty(props.query, `No apps made in ${props.space.name} yet.`)}
        </EmptyState>
      ) : (
        <Loading id={shapeId} loading={listed.isPending} label="Loading apps">
          <AppGrid label={`Apps made in ${props.space.name}`}>
            {listed.isPending
              ? Array.from({ length: 4 }, (_, index) => (
                  <AppRow key={index} name="Team app" caption="Tools for your team’s work" />
                ))
              : owned.map((app) => (
                  <AppRow
                    key={app.id}
                    name={app.name}
                    icon={app.icon}
                    caption={app.description}
                    onOpen={() => void navigate({ to: "/apps/$appId", params: { appId: app.id } })}
                  />
                ))}
          </AppGrid>
        </Loading>
      )}
      {creating ? <CustomAppDialog spaceId={props.space.id} onClose={() => setCreating(false)} /> : null}
    </>
  )
}

function AppsPills(props: { show: "custom" | undefined; onShow: (show: "installed" | "custom") => void }) {
  return (
    <PageTabs>
      <Tabs
        value={props.show ?? "installed"}
        onValueChange={(value: string) => props.onShow(value === "custom" ? "custom" : "installed")}
      >
        <PageTabsList>
          <PageTabsTrigger value="installed">Installed</PageTabsTrigger>
          <PageTabsTrigger value="custom">Custom</PageTabsTrigger>
        </PageTabsList>
      </Tabs>
    </PageTabs>
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
  const [adding, setAdding] = useState(false)
  const remove = useRemoveApp(space)
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
      <AppsPills
        show={search.show}
        onShow={(next) =>
          void navigate({
            search: (previous) => ({ ...previous, show: next === "custom" ? "custom" : undefined }),
            replace: true,
          })
        }
      />
      <PageActions>
        <ToolbarSearch label="Search apps" value={query} onChange={setQuery} />
        <Button onClick={() => setAdding(true)}>
          <IconPlus />
          Add app
        </Button>
      </PageActions>
      <AddAppDialog
        space={space}
        added={new Set(byApp.keys())}
        open={adding}
        onOpenChange={setAdding}
        onPick={(picked) => setProfile({ appId: picked.id, from })}
      />
      {search.show === "custom" ? (
        <CustomApps space={space} query={query} />
      ) : (
        <>
          <Loading id={shapeId} loading={reach.isPending || catalog.pending} label="Loading apps">
            {reach.isPending || catalog.pending ? (
              <TableSample columns={["App", "Used in", "Status", ""]} count={3} />
            ) : (
              <AppsTable
                rows={shown.items}
                empty={<NoApps query={query} space={space.name} onAdd={() => setAdding(true)} />}
                onOpen={setOpened}
                onNew={(appId) => setProfile({ appId, from, newAccount: true })}
                remove={remove}
              />
            )}
          </Loading>
          <LoadMore more={shown.more} onMore={shown.next} />
        </>
      )}
      <AppSheet app={app} onClose={() => setOpened(undefined)}>
        {app ? (
          <AccountList
            title="Accounts"
            app={app}
            actions={
              <AddAccount
                onNew={() => setProfile({ appId: app.id, from, newAccount: true })}
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
