import { Button } from "@ren/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Icon } from "@ren/ui/icon"
import { PageShell } from "@ren/ui/page-shell"
import { SearchField } from "@ren/ui/search-field"
import { Spinner } from "@ren/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@ren/ui/toggle-group"
import { Toolbar } from "@ren/ui/toolbar"
import { useDeferredValue, useState } from "react"
import { ProfileDialog } from "../../components/profile-dialog.js"
import { Profiles } from "../../components/profiles.js"
import { AddToSpace } from "../../components/add-to-space.js"
import { AccountList, AppDrawer } from "./app-drawer.js"
import { AppGrid, AppRow } from "../../components/app-row.js"
import { Apps } from "../../components/apps.js"

export type View = "browse" | "in-use"

// oxlint-disable-next-line ren/no-comments -- ren-v1 Marketplace: browse every app, or the ones in use (a profile you can see). Each row adds the app to a space; a click opens its drawer.
export function AppsPage(props: {
  view: View
  appId: string | undefined
  onViewChange: (view: View) => void
  onAppChange: (appId: string | undefined) => void
}) {
  const catalog = Apps.useCatalog()
  const [query, setQuery] = useState("")
  const [profileOf, setProfileOf] = useState<{ readonly appId: string; readonly profileId: string }>()
  const needle = useDeferredValue(query).trim()
  const rows = catalog.entries.filter(
    (entry) => Apps.matches(entry, needle) && (props.view === "browse" || catalog.profiles.has(entry.id)),
  )
  const opened = catalog.entries.find((entry) => entry.id === props.appId)
  const openedProfiles = opened ? (catalog.profiles.get(opened.id) ?? []) : []
  const openProfile = (appId: string) => (profileId: string) => setProfileOf({ appId, profileId })
  return (
    <PageShell.Root
      title="Marketplace"
      subtitle="Add an app to a space, then connect its accounts. Every chat in the space can use it."
      toolbar={
        <Toolbar.Root
          alignment="split"
          leading={
            <ToggleGroup
              aria-label="Marketplace view"
              value={[props.view]}
              onValueChange={(next) => {
                const view = next[0]
                if (view === "browse" || view === "in-use") props.onViewChange(view)
              }}
            >
              <ToggleGroupItem value="browse">Browse</ToggleGroupItem>
              <ToggleGroupItem value="in-use">In use</ToggleGroupItem>
            </ToggleGroup>
          }
        >
          <SearchField.Expandable value={query} onValueChange={setQuery} placeholder="Search apps" />
        </Toolbar.Root>
      }
    >
      <section aria-label="Apps" aria-live="polite">
        <Catalog
          state={catalog.state}
          needle={needle}
          rows={rows}
          catalog={catalog}
          onRetry={() => void catalog.retry()}
          onOpen={props.onAppChange}
          onAdded={openProfile}
        />
      </section>
      <AppDrawer
        app={opened}
        action={
          opened ? (
            <AddToSpace
              app={opened}
              profiles={openedProfiles}
              spaces={catalog.spaces}
              appearance="primary"
              onAdded={openProfile(opened.id)}
            />
          ) : null
        }
        onClose={() => props.onAppChange(undefined)}
      >
        <AccountList
          title="Accounts"
          profiles={openedProfiles}
          caption={Profiles.audience}
          action={(profile) => (
            <Button variant="outline" size="sm" onClick={() => openProfile(profile.appId)(profile.id)}>
              {Apps.connectLabel(profile) ?? "Open"}
            </Button>
          )}
        />
      </AppDrawer>
      {profileOf ? (
        <ProfileDialog
          appId={profileOf.appId}
          profileId={profileOf.profileId}
          onClose={() => setProfileOf(undefined)}
        />
      ) : null}
    </PageShell.Root>
  )
}

function Catalog(props: {
  state: "failed" | "loading" | "ready"
  needle: string
  rows: ReadonlyArray<Apps.Entry>
  catalog: ReturnType<typeof Apps.useCatalog>
  onRetry: () => void
  onOpen: (appId: string) => void
  onAdded: (appId: string) => (profileId: string) => void
}) {
  if (props.state === "failed")
    return (
      <Empty role="alert">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon glyph="AlertCircle" />
          </EmptyMedia>
          <EmptyTitle>Couldn’t load apps.</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={props.onRetry}>
            Try again
          </Button>
        </EmptyContent>
      </Empty>
    )
  if (props.state === "loading")
    return (
      <Empty>
        <EmptyMedia>
          <Spinner />
        </EmptyMedia>
      </Empty>
    )
  if (props.rows.length === 0)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon glyph="Extension" />
          </EmptyMedia>
          <EmptyTitle>{props.needle ? `Nothing matches “${props.needle}”` : "No apps in use"}</EmptyTitle>
          {props.needle ? null : <EmptyDescription>Browse apps and add one to a space.</EmptyDescription>}
        </EmptyHeader>
      </Empty>
    )
  return (
    <AppGrid label="Apps">
      {props.rows.map((entry) => {
        const profiles = props.catalog.profiles.get(entry.id) ?? []
        return (
          <AppRow
            key={entry.id}
            name={entry.name}
            icon={entry.icon}
            caption={profiles.length > 0 ? Apps.summary(profiles) : entry.description}
            onOpen={() => props.onOpen(entry.id)}
            action={
              <AddToSpace
                app={entry}
                profiles={profiles}
                spaces={props.catalog.spaces}
                onAdded={props.onAdded(entry.id)}
              />
            }
          />
        )
      })}
    </AppGrid>
  )
}
