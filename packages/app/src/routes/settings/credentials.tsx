import { useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { IconPlus } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Tabs } from "@/components/ui/tabs"
import { AccountActions } from "@/components/ren/account-actions"
import { AccountList, AppSheet } from "@/components/ren/app-list"
import { AppsTable } from "@/components/ren/apps-table"
import { CredentialSheet, ownerOptions } from "@/components/ren/credential-sheet"
import { CredentialsTable } from "@/components/ren/credentials-table"
import { ListPagination } from "@/components/ren/list-pagination"
import { Page, PageTabsList, PageTabsTrigger, SkeletonRows } from "@/components/ren/page"
import { ProfileDialog, type ProfileTarget } from "@/components/ren/profile-dialog"
import { ToolbarSearch } from "@/components/ren/toolbar-search"
import { useCatalog } from "@/hooks/use-catalog"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useMe } from "@/hooks/use-me"
import { useSpaces } from "@/hooks/use-spaces"
import { api, pageSize } from "@/lib/api"
import { reach, usedIn } from "@/lib/apps"
import { currentPage, lastPageAfterRemoval } from "@/lib/pagination"

const route = getRouteApi("/_authed/settings/credentials")

function useCredentialsPage() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const me = useMe()
  const spaces = useSpaces().spaces
  const tab = search.tab ?? "apps"
  const page = currentPage(search)
  const [query, setQuery] = useState("")
  const needle = useDebouncedValue(query.trim(), 250)
  const [adding, setAdding] = useState(false)
  const keys = useQuery({
    ...api.credential.list.queryOptions({ page, pageSize, ...(needle && { search: needle }) }),
    placeholderData: keepPreviousData,
    select: (data) => ({ ...data, items: data.items.filter((credential) => credential.owner.kind !== "profile") }),
  })
  const total = keys.data?.total ?? 0
  return {
    tab,
    page,
    total,
    openTab: (next: string) => void navigate({ search: { tab: next === "keys" ? "keys" : "apps" } }),
    query,
    setQuery,
    adding,
    setAdding,
    keys: keys.data?.items,
    stale: keys.isPlaceholderData,
    userId: me.user.id,
    owners: ownerOptions(spaces),
    removed: () => {
      const next = lastPageAfterRemoval(page, total, pageSize)
      if (next !== page) void navigate({ search: (previous) => ({ ...previous, page: next }) })
    },
  }
}

export function CredentialsSettingsPage() {
  const page = useCredentialsPage()
  return (
    <Page
      title="Credentials"
      description="App accounts and keys you can use."
      leading={
        <Tabs value={page.tab} onValueChange={(value: string) => page.openTab(value)}>
          <PageTabsList>
            <PageTabsTrigger value="apps">Apps</PageTabsTrigger>
            <PageTabsTrigger value="keys" count={page.tab === "keys" ? page.total : undefined}>
              Keys
            </PageTabsTrigger>
          </PageTabsList>
        </Tabs>
      }
      actions={
        page.tab === "keys" ? (
          <>
            <ToolbarSearch label="Search keys" value={page.query} onChange={page.setQuery} />
            <Button onClick={() => page.setAdding(true)}>
              <IconPlus />
              Add key
            </Button>
          </>
        ) : undefined
      }
      footer={
        page.tab === "keys" ? (
          <ListPagination page={page.page} pageSize={pageSize} total={page.total} noun="key" />
        ) : undefined
      }
    >
      {page.tab === "apps" ? (
        <OrgApps />
      ) : page.keys ? (
        <CredentialsTable
          credentials={page.keys}
          stale={page.stale}
          onRemoved={page.removed}
          empty={page.query ? `Nothing matches “${page.query.trim()}”` : "No keys"}
        />
      ) : (
        <SkeletonRows count={4} />
      )}
      <CredentialSheet
        open={page.adding}
        onOpenChange={page.setAdding}
        title="Add key"
        description="Paste a key. Ren keeps it encrypted and never shows it again."
        owners={page.owners}
        userId={page.userId}
      />
    </Page>
  )
}

function OrgApps() {
  const catalog = useCatalog()
  const [opened, setOpened] = useState<string>()
  const [profile, setProfile] = useState<ProfileTarget>()
  const used = catalog.apps.filter((app) => catalog.profilesOf(app.id).length > 0)
  const app = opened ? catalog.appOf(opened) : undefined
  if (catalog.loading) return <SkeletonRows count={4} />
  return (
    <>
      <AppsTable
        rows={used.map((each) => ({
          app: each,
          profiles: catalog.profilesOf(each.id),
          usedIn: usedIn(catalog.profilesOf(each.id)),
        }))}
        empty="No apps. Add one to a space from the Marketplace."
        onOpen={setOpened}
        onNew={(appId) => setProfile({ appId })}
      />
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
            profiles={catalog.profilesOf(app.id)}
            caption={reach}
            onOpen={(each) => setProfile({ appId: each.appId, profileId: each.id, edit: true })}
            action={(each) => (
              <AccountActions profile={each} onOpen={() => setProfile({ appId: each.appId, profileId: each.id })} />
            )}
          />
        ) : null}
      </AppSheet>
      {profile ? <ProfileDialog {...profile} onClose={() => setProfile(undefined)} /> : null}
    </>
  )
}
