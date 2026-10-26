import type { AppProfileInfo } from "@ren/client"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { LoadingMessage } from "@ren/ui/loading-message"
import { StateMessage } from "@ren/ui/state-message"
import { Toast } from "@ren/ui/toast"
import { Toolbar } from "@ren/ui/toolbar"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { AddAppDialog } from "../../components/add-app-dialog.js"
import { ProfileDialog } from "../../components/profile-dialog.js"
import { Profiles } from "../../components/profiles.js"
import { RouterContext } from "../../lib/router-context.js"
import { AccountActions } from "../../components/account-actions.js"
import { AccountList, AppDrawer } from "./app-drawer.js"
import { AppGrid, AppRow } from "../../components/app-row.js"
import { Apps } from "../../components/apps.js"

type Opened = { readonly appId: string; readonly profileId?: string }

type Access = { readonly id: string; readonly add?: Array<string>; readonly remove?: Array<string> }

const accounts = (count: number) => (count === 1 ? "1 account" : `${count} accounts`)

// oxlint-disable-next-line ren/no-comments -- ren-v1 project Connections → Apps: one row per app the space reaches; its panel lists the space's accounts for it, adds another, or uses one from elsewhere in the org.
export function SpaceApps(props: {
  spaceId: string
  appId: string | undefined
  onAppChange: (appId?: string) => void
}) {
  const context = RouterContext.useRouterContext()
  const queryClient = useQueryClient()
  const catalog = Apps.useCatalog()
  const space = useQuery(context.api.space.get.queryOptions({ idOrSlug: props.spaceId }))
  const reach = useQuery({
    ...context.api["app-profile-reach"].space.profiles.queryOptions({ id: props.spaceId }),
    refetchOnWindowFocus: "always",
  })
  const access = useMutation(context.api["app-profile"].access.mutationOptions())
  const [dialog, setDialog] = useState<Opened>()
  const [adding, setAdding] = useState(false)
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: context.api["app-profile-reach"].space.profiles.queryKey() }),
      queryClient.invalidateQueries({ queryKey: context.api["app-profile"].list.queryKey() }),
    ])
  const change = (input: Access, title: string) =>
    access.mutate(input, {
      onSuccess: () => void refresh(),
      onError: (error) => Toast.manager.add({ type: "error", title, description: error.message }),
    })
  const byApp = Map.groupBy(reach.data?.profiles ?? [], (profile) => profile.appId)
  const apps = new Map(catalog.entries.map((entry) => [entry.id, entry]))
  const opened = props.appId ? apps.get(props.appId) : undefined
  return (
    <>
      <Toolbar.Root>
        <Button appearance="primary" size="small" leadingIcon={<Icon glyph="Plus" />} onClick={() => setAdding(true)}>
          Add app
        </Button>
      </Toolbar.Root>
      <ReachState state={reachedOf(reach)} count={byApp.size} onRetry={() => void reach.refetch()} />
      <AppGrid label="Apps in this space">
        {[...byApp].map(([appId, profiles]) => (
          <SpaceAppRow
            key={appId}
            app={apps.get(appId)}
            profiles={profiles}
            spaceId={props.spaceId}
            onOpen={() => props.onAppChange(appId)}
          />
        ))}
      </AppGrid>
      <AppDrawer app={opened} onClose={() => props.onAppChange()}>
        {opened ? (
          <Accounts
            spaceId={props.spaceId}
            here={byApp.get(opened.id) ?? []}
            org={catalog.profiles.get(opened.id) ?? []}
            onOpen={(profile) => setDialog({ appId: profile.appId, profileId: profile.id })}
            onNew={() => setDialog({ appId: opened.id })}
            onChange={change}
          />
        ) : null}
      </AppDrawer>
      {adding && space.data ? (
        <AddAppDialog
          space={space.data}
          added={new Set(byApp.keys())}
          onAdded={(added) => {
            setAdding(false)
            void refresh()
            setDialog(added)
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {dialog ? (
        <ProfileDialog
          appId={dialog.appId}
          {...(dialog.profileId && { profileId: dialog.profileId })}
          {...(space.data && { from: { spaceId: props.spaceId, members: space.data.memberCount } })}
          onClose={() => {
            setDialog(undefined)
            void refresh()
          }}
        />
      ) : null}
    </>
  )
}

type Reached = "loading" | "hidden" | "failed" | "ready"

const reachedOf = (reach: {
  readonly status: "pending" | "error" | "success"
  readonly error: Error | null
}): Reached => {
  if (reach.status === "pending") return "loading"
  if (reach.status === "success") return "ready"
  return reach.error?.name === "NotFoundError" ? "hidden" : "failed"
}

function ReachState(props: { state: Reached; count: number; onRetry: () => void }) {
  if (props.state === "loading") return <LoadingMessage placement="section" />
  if (props.state === "hidden")
    return <StateMessage state="unavailable" title="Only members of this space see its apps." />
  if (props.state === "failed")
    return <StateMessage state="failed" title="Couldn’t load apps." onRetry={props.onRetry} />
  return props.count === 0 ? <StateMessage state="empty" title="No apps" /> : null
}

function SpaceAppRow(props: {
  app: Apps.Entry | undefined
  profiles: ReadonlyArray<AppProfileInfo>
  spaceId: string
  onOpen: () => void
}) {
  const gaps = props.profiles.reduce((total, profile) => total + Profiles.gaps(profile).length, 0)
  const only = props.profiles.length === 1 ? props.profiles[0] : undefined
  const counted = `${accounts(props.profiles.length)}${gaps ? " · not connected" : ""}`
  return (
    <AppRow
      name={props.app?.name ?? props.profiles[0]?.appSlug ?? ""}
      icon={props.app?.icon}
      caption={only ? Apps.caption(only, props.spaceId) : counted}
      attention={gaps > 0}
      onOpen={props.onOpen}
    />
  )
}

function Accounts(props: {
  spaceId: string
  here: ReadonlyArray<AppProfileInfo>
  org: ReadonlyArray<AppProfileInfo>
  onOpen: (profile: AppProfileInfo) => void
  onNew: () => void
  onChange: (input: Access, title: string) => void
}) {
  const elsewhere = props.org.filter(
    (profile) => profile.kind === "shared" && !props.here.some((reached) => reached.id === profile.id),
  )
  return (
    <>
      <AccountList
        title="Accounts"
        actions={
          <Button appearance="primary" size="small" leadingIcon={<Icon glyph="Plus" />} onClick={props.onNew}>
            New
          </Button>
        }
        profiles={props.here}
        caption={(profile) => Apps.caption(profile, props.spaceId)}
        action={(profile) => (
          <AccountActions
            profile={profile}
            onOpen={() => props.onOpen(profile)}
            onRemove={
              profile.spaces.some((each) => each.id === props.spaceId)
                ? () => props.onChange({ id: profile.id, remove: [props.spaceId] }, "Couldn’t remove the account")
                : undefined
            }
          />
        )}
      />
      <AccountList
        title="Other accounts in your org"
        profiles={elsewhere}
        caption={(profile) => Apps.source(profile, props.spaceId)}
        action={(profile) => (
          <Button
            appearance="secondary"
            size="small"
            onClick={() => props.onChange({ id: profile.id, add: [props.spaceId] }, "Couldn’t add the account")}
          >
            Use here
          </Button>
        )}
      />
    </>
  )
}
