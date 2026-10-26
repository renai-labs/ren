import type { AppProfileInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { LoadingMessage } from "@ren/ui/loading-message"
import { StateMessage } from "@ren/ui/state-message"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { AccountAccess } from "../../components/account-access.js"
import { AccountActions } from "../../components/account-actions.js"
import { AppGrid, AppRow } from "../../components/app-row.js"
import { Apps } from "../../components/apps.js"
import { ProfileDialog } from "../../components/profile-dialog.js"
import { Profiles } from "../../components/profiles.js"
import { Auth } from "../../lib/auth.js"
import { RouterContext } from "../../lib/router-context.js"
import { AccountList, AppDrawer } from "./app-drawer.js"

// oxlint-disable-next-line ren/no-comments -- The space Apps tab for the whole org: every app with an account you can see, and where each account is used.
export function OrgApps(props: { appId: string | undefined; userId: string; onAppChange: (appId?: string) => void }) {
  const context = RouterContext.useRouterContext()
  const role = useQuery(Auth.activeRoleOptions(context.auth))
  const spaces = useQuery(context.api.space.list.queryOptions(Apps.page))
  const catalog = Apps.useCatalog()
  const [dialog, setDialog] = useState<{ readonly appId: string; readonly profileId?: string }>()
  const used = catalog.entries.filter((entry) => catalog.profiles.has(entry.id))
  const opened = used.find((entry) => entry.id === props.appId)
  return (
    <>
      {catalog.state === "loading" ? <LoadingMessage placement="section" /> : null}
      {catalog.state === "failed" ? (
        <StateMessage state="failed" title="Couldn’t load apps." onRetry={() => void catalog.retry()} />
      ) : null}
      {catalog.state === "ready" && used.length === 0 ? <StateMessage state="empty" title="No apps" /> : null}
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
              <Button
                appearance="primary"
                size="small"
                leadingIcon={<Icon glyph="Plus" />}
                onClick={() => setDialog({ appId: opened.id })}
              >
                New
              </Button>
            }
            profiles={catalog.profiles.get(opened.id) ?? []}
            caption={Apps.reach}
            action={(profile: AppProfileInfo) => (
              <>
                <AccountAccess
                  profile={profile}
                  spaces={spaces.data?.items ?? []}
                  userId={props.userId}
                  admin={role.data !== undefined && Auth.isAdminRole(role.data)}
                />
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
