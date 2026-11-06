import { useState } from "react"
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query"
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
import { ListPagination } from "../../components/list-pagination.js"
import { Page, PageFooter, PageTabsList, PageTabsTrigger, TableSample, useShapeId } from "../../components/page.js"
import { Loading } from "@ren/ui/loading"
import { ProfileDialog, type ProfileTarget } from "../../components/profile-dialog.js"
import { ToolbarSearch } from "../../components/toolbar-search.js"
import { useApp } from "../../lib/use-app.js"
import { useAppProfiles } from "../../lib/use-app-profiles.js"
import { useDebouncedValue } from "../../lib/use-debounced-value.js"
import { useMe } from "../../lib/use-me.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { pageSize, currentPage, lastPageAfterRemoval } from "../../lib/pagination.js"
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
  const { api } = RouterContext.useRouterContext()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const me = useMe()
  const spaces = useSpaces().spaces
  const page = currentPage(search)
  const [query, setQuery] = useState("")
  const needle = useDebouncedValue(query.trim(), 250)
  const [adding, setAdding] = useState(false)
  const keysShapeId = useShapeId("keys")
  const list = useQuery({
    ...api.credential.list.queryOptions({ page, pageSize, ...(needle && { search: needle }) }),
    placeholderData: keepPreviousData,
    select: (data) => ({ ...data, items: data.items.filter((credential) => credential.owner.kind !== "profile") }),
    ...Loader.required,
  })
  const total = list.data?.total ?? 0
  const removed = () => {
    const next = lastPageAfterRemoval(page, total, pageSize)
    if (next !== page) void navigate({ search: (previous) => ({ ...previous, page: next }) })
  }
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
      footer={<ListPagination page={page} pageSize={pageSize} total={total} noun="key" />}
    >
      <Loading id={keysShapeId} loading={!list.data} label="Loading keys">
        {list.data ? (
          <CredentialsTable
            credentials={list.data.items}
            stale={list.isPlaceholderData}
            onRemoved={removed}
            empty={query ? `Nothing matches “${query.trim()}”` : "No keys"}
          />
        ) : (
          <TableSample columns={["Key", "Hosts", "Owner", ""]} />
        )}
      </Loading>
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
  const { api } = RouterContext.useRouterContext()
  const deleteProfile = useMutation(api["app-profile-reach"]["app-profile"].delete.mutationOptions())
  const spaces = useSpaces().spaces
  const page = currentPage(search)
  const list = useQuery({
    ...api.app.list.queryOptions({ connected: true, page, pageSize }),
    placeholderData: keepPreviousData,
  })
  const used = (list.data?.items ?? []).map(fromApp).filter((app) => !isSpaceApp(app, spaces))
  const app = useApp(opened).app
  const profiles = useAppProfiles(used.map((each) => each.id))
  const accounts = useAppProfiles(app ? [app.id] : [])
  const loading = list.isPending || profiles.pending
  return (
    <>
      <Loading id={appsShapeId} loading={loading} label="Loading apps">
        {loading ? (
          <TableSample columns={["App", "Used in", "Status", ""]} />
        ) : (
          <AppsTable
            rows={used.map((each) => ({
              app: each,
              profiles: profiles.of(each.id),
              usedIn: usedIn(profiles.of(each.id)),
            }))}
            empty="No apps. Add one to a space from the Marketplace."
            onOpen={setOpened}
            onNew={(appId) => setProfile({ appId })}
          />
        )}
      </Loading>
      <PageFooter>
        <ListPagination page={page} pageSize={pageSize} total={list.data?.total ?? 0} noun="app" />
      </PageFooter>
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
