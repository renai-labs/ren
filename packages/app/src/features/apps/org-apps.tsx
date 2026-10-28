import type { AppProfileInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Spinner } from "@ren/ui/spinner"
import { useQuery } from "@tanstack/react-query"
import { useRouteContext } from "@tanstack/react-router"
import { useState } from "react"
import { AccountAccess } from "../../components/account-access.js"
import { AccountActions } from "../../components/account-actions.js"
import { AppGrid, AppRow } from "../../components/app-row.js"
import { Apps } from "../../components/apps.js"
import { ProfileDialog } from "../../components/profile-dialog.js"
import { Profiles } from "../../components/profiles.js"
import { RouterContext } from "../../lib/router-context.js"
import { AccountList, AppDrawer } from "./app-drawer.js"

// oxlint-disable-next-line ren/no-comments -- The space Apps tab for the whole org: every app with an account you can see, and where each account is used.
export function OrgApps(props: { appId: string | undefined; onAppChange: (appId?: string) => void }) {
  const context = RouterContext.useRouterContext()
  const authed = useRouteContext({ from: "/_authed" })
  const spaces = useQuery(context.api.space.list.queryOptions(Apps.page))
  const catalog = Apps.useCatalog()
  const [dialog, setDialog] = useState<{ readonly appId: string; readonly profileId?: string }>()
  const used = catalog.entries.filter((entry) => catalog.profiles.has(entry.id))
  const opened = used.find((entry) => entry.id === props.appId)
  return (
    <>
      {catalog.state === "loading" ? (
        <Empty>
          <EmptyMedia>
            <Spinner />
          </EmptyMedia>
        </Empty>
      ) : null}
      {catalog.state === "failed" ? (
        <Empty role="alert">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon glyph="AlertCircle" />
            </EmptyMedia>
            <EmptyTitle>Couldn’t load apps.</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={() => void catalog.retry()}>
              Try again
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}
      {catalog.state === "ready" && used.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No apps</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : null}
      <AppGrid label="Apps in your organization">
        {used.map((entry) => {
          const profiles = catalog.profiles.get(entry.id) ?? []
          return (
            <AppRow
              key={entry.id}
              name={entry.name}
              icon={entry.icon}
              caption={Apps.summary(profiles)}
              attention={profiles.some((profile) => Profiles.gaps(profile).length > 0)}
              onOpen={() => props.onAppChange(entry.id)}
            />
          )
        })}
      </AppGrid>
      <AppDrawer app={opened} onClose={() => props.onAppChange()}>
        {opened ? (
          <AccountList
            title="Accounts"
            actions={
              <Button size="sm" onClick={() => setDialog({ appId: opened.id })}>
                <Icon glyph="Plus" data-icon="inline-start" />
                New
              </Button>
            }
            profiles={catalog.profiles.get(opened.id) ?? []}
            caption={Apps.reach}
            action={(profile: AppProfileInfo) => (
              <>
                <AccountAccess profile={profile} spaces={spaces.data?.items ?? []} userId={authed.me.user.id} />
                <AccountActions
                  profile={profile}
                  onOpen={() => setDialog({ appId: profile.appId, profileId: profile.id })}
                />
              </>
            )}
          />
        ) : null}
      </AppDrawer>
      {dialog ? (
        <ProfileDialog
          appId={dialog.appId}
          {...(dialog.profileId && { profileId: dialog.profileId })}
          onClose={() => setDialog(undefined)}
        />
      ) : null}
    </>
  )
}
