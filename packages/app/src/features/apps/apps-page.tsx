import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { LoadingMessage } from "@ren/ui/loading-message"
import { PageShell } from "@ren/ui/page-shell"
import { SearchField } from "@ren/ui/search-field"
import { SegmentedControl } from "@ren/ui/segmented-control"
import { StateMessage } from "@ren/ui/state-message"
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
            <SegmentedControl<View>
              label="Marketplace view"
              value={props.view}
              onValueChange={props.onViewChange}
              options={[
                { value: "browse", label: "Browse" },
                { value: "in-use", label: "In use" },
              ]}
            />
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
            <Button appearance="secondary" size="small" onClick={() => openProfile(profile.appId)(profile.id)}>
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
    return <StateMessage state="failed" title="Couldn’t load apps." onRetry={props.onRetry} />
  if (props.state === "loading") return <LoadingMessage placement="section" />
  if (props.rows.length === 0)
    return (
      <StateMessage
        state={props.needle ? "no-results" : "empty"}
        icon={<Icon glyph="Extension" size="medium" tone="secondary" />}
        title={props.needle ? `Nothing matches “${props.needle}”` : "No apps in use"}
        description={props.needle ? undefined : "Browse apps and add one to a space."}
      />
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
