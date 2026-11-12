import { useState } from "react"
import { keepPreviousData, useInfiniteQuery, useMutation } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import { errorMessage } from "../../lib/errors.js"
import { getRouteApi } from "@tanstack/react-router"
import { IconPlus } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Tabs } from "@ren/ui/tabs"
import { AccountActions } from "../../components/account-actions.js"
import { AccountList, AppSheet } from "../../components/app-list.js"
import { AppsTable } from "../../components/apps-table.js"
import { CredentialSheet, ownerOptions } from "../../components/credential-sheet.js"
import { CredentialsTable } from "../../components/credentials-table.js"
import { LoadMore } from "../../components/load-more.js"
import { Page, PageActions, PageTabsList, PageTabsTrigger, TableSample, useShapeId } from "../../components/page.js"
import { Loading } from "@ren/ui/loading"
import { ProfileDialog, type ProfileTarget } from "../../components/profile-dialog.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { useApp } from "../../lib/use-app.js"
import { useAppProfiles } from "../../lib/use-app-profiles.js"
import { useDebouncedValue } from "../../lib/use-debounced-value.js"
import { useMe } from "../../lib/use-me.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { Pages } from "../../lib/pages.js"
import { Search } from "../../lib/search.js"
import { fromApp, isSpaceApp, reach, usedIn } from "../../lib/apps.js"
import { RouterContext } from "../../lib/router-context.js"
import { Loader } from "../../lib/loader.js"

const route = getRouteApi("/_authed/_shell/settings/credentials")

function CredentialTabs(props: { tab: "apps" | "keys"; keys?: number | undefined }) {
  const navigate = route.useNavigate()
  return (
    <Tabs
      value={props.tab}
      onValueChange={(value: string) => void navigate({ search: { tab: value === "keys" ? "keys" : "apps" } })}
    >
      <PageTabsList>
        <PageTabsTrigger value="apps">Apps</PageTabsTrigger>
        <PageTabsTrigger value="keys" count={props.keys}>
          Keys
        </PageTabsTrigger>
      </PageTabsList>
    </Tabs>
  )
}

export function CredentialsSettingsPage() {
  const search = route.useSearch()
  if (search.tab === "keys") return <CredentialKeys />
  return (
    <Page title="Credentials" description="App accounts and keys you can use." leading={<CredentialTabs tab="apps" />}>
      <OrgApps />
    </Page>
  )
}

function CredentialKeys() {
  const { client } = RouterContext.useRouterContext()
  const me = useMe()
  const spaces = useSpaces().spaces
  const [query, setQuery] = useState("")
  const needle = useDebouncedValue(query.trim(), 250)
  const [adding, setAdding] = useState(false)
  const keysShapeId = useShapeId("keys")
  const list = useInfiniteQuery({
    ...Pages.credentials(client, needle ? { search: needle } : {}),
    placeholderData: keepPreviousData,
    select: (data) => ({
      total: data.pages.at(0)?.total ?? 0,
      items: data.pages.flatMap((page) => page.items).filter((credential) => credential.owner.kind !== "profile"),
    }),
    ...Loader.required,
  })
  const total = list.data?.total ?? 0
  return (
    <Page
      title="Credentials"
      description="App accounts and keys you can use."
      leading={<CredentialTabs tab="keys" keys={total} />}
      actions={
        <>
          <ToolbarSearch label="Search keys" value={query} onChange={setQuery} />
          <Button onClick={() => setAdding(true)}>
            <IconPlus />
            Add key
          </Button>
        </>
      }
    >
      <Loading id={keysShapeId} loading={!list.data} label="Loading keys">
        {list.data ? (
          <CredentialsTable
            credentials={list.data.items}
            stale={list.isPlaceholderData}
            empty={Search.empty(query, "No keys")}
          />
        ) : (
          <TableSample columns={["Key", "Hosts", "Owner", ""]} />
        )}
      </Loading>
      <LoadMore more={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
      <CredentialSheet
        open={adding}
        onOpenChange={setAdding}
        title="Add key"
        description="Paste a key. Ren keeps it encrypted and never shows it again."
        owners={ownerOptions(spaces)}
        userId={me.user.id}
      />
    </Page>
  )
}

function OrgApps() {
  const appsShapeId = useShapeId("apps")
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const opened = search.app
  const setOpened = (app: string | undefined) => void navigate({ search: (previous) => ({ ...previous, app }) })
  const [profile, setProfile] = useState<ProfileTarget>()
  const { api, client } = RouterContext.useRouterContext()
  const deleteProfile = useMutation(api["app-profile-reach"]["app-profile"].delete.mutationOptions())
  const spaces = useSpaces().spaces
  const list = useInfiniteQuery(Pages.connectedApps(client))
  const used = (list.data?.pages ?? [])
    .flatMap((page) => page.items)
    .map(fromApp)
    .filter((app) => !isSpaceApp(app, spaces))
  const app = useApp(opened).app
  const profiles = useAppProfiles(used.map((each) => each.id))
  const accounts = useAppProfiles(app ? [app.id] : [])
  const loading = list.isPending || profiles.pending
  const [query, setQuery] = useState("")
  return (
    <>
      <PageActions>
        <ToolbarSearch label="Search apps" value={query} onChange={setQuery} />
      </PageActions>
      <Loading id={appsShapeId} loading={loading} label="Loading apps">
        {loading ? (
          <TableSample columns={["App", "Used in", "Status", ""]} />
        ) : (
          <AppsTable
            rows={used
              .map((each) => ({ app: each, profiles: profiles.of(each.id), usedIn: usedIn(profiles.of(each.id)) }))
              .filter((row) => Search.matches(query, row.app.name, row.app.description, row.usedIn))}
            empty={Search.empty(query, "No apps. Add one to a space from Apps.")}
            onOpen={setOpened}
            onNew={(appId) => setProfile({ appId })}
          />
        )}
      </Loading>
      <LoadMore more={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
      <AppSheet app={app} onClose={() => setOpened(undefined)}>
        {app ? (
          <AccountList
            title="Accounts"
            actions={
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setProfile({ appId: app.id })}
              >
                <IconPlus />
                New account
              </Button>
            }
            profiles={accounts.of(app.id)}
            caption={reach}
            onOpen={(each) => setProfile({ appId: each.appId, profileId: each.id, edit: true })}
            action={(each) => (
              <AccountActions
                profile={each}
                onOpen={() => setProfile({ appId: each.appId, profileId: each.id })}
                onDelete={() =>
                  deleteProfile.mutateAsync(
                    { id: each.id },
                    {
                      onSuccess: () => toast.success(`${each.name} deleted`),
                      onError: (error) =>
                        toast.error("Couldn’t delete the account", { description: errorMessage(error) }),
                    },
                  )
                }
              />
            )}
          />
        ) : null}
      </AppSheet>
      {profile ? <ProfileDialog {...profile} onClose={() => setProfile(undefined)} /> : null}
    </>
  )
}
