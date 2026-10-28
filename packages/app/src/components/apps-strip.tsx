import type { AppProfileInfo, CredentialInfo, SpaceKind } from "@ren/client"
import { Credential } from "@ren/schema/credential"
import { Avatar } from "@ren/ui/avatar"
import { Icon } from "@ren/ui/icon"
import { Menu } from "@ren/ui/menu"
import { Select } from "@ren/ui/select"
import { StatusDot } from "@ren/ui/status-dot"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useRouteContext } from "@tanstack/react-router"
import { useState } from "react"
import { RouterContext } from "../lib/router-context.js"
import { useSignIn } from "./account-actions.js"
import { AddAppDialog } from "./add-app-dialog.js"
import { Apps } from "./apps.js"
import { PasteCredentialDialog } from "./paste-credential-dialog.js"
import { ProfileDialog } from "./profile-dialog.js"
import { Profiles } from "./profiles.js"

// oxlint-disable-next-line ren/no-comments -- profiles.md P15: the apps a chat reaches, with what is missing. ren-v1's composer menu: Apps and Credentials, each with an add entry.
export function SessionAppsStrip(props: { readonly sessionId: string }) {
  const context = RouterContext.useRouterContext()
  const session = useQuery(context.api.session.get.queryOptions({ idOrSlug: props.sessionId }))
  const reach = useQuery({
    ...context.api["app-profile-reach"].session.profiles.queryOptions({ id: props.sessionId }),
    refetchOnWindowFocus: "always",
  })
  if (!session.data) return null
  return <Strip spaceId={session.data.spaceId} profiles={reach.data?.profiles ?? []} />
}

// oxlint-disable-next-line ren/no-comments -- The same for a new chat of the caller in a space.
export function SpaceAppsStrip(props: { readonly spaceId: string }) {
  const context = RouterContext.useRouterContext()
  const reach = useQuery({
    ...context.api["app-profile-reach"].space.profiles.queryOptions({ id: props.spaceId }),
    refetchOnWindowFocus: "always",
  })
  return <Strip spaceId={props.spaceId} profiles={reach.data?.profiles ?? []} />
}

type Dialogs =
  | { readonly kind: "add-app" }
  | { readonly kind: "profile"; readonly appId: string; readonly profileId?: string }
  | { readonly kind: "credential" }
  | undefined

function Strip(props: { spaceId: string; profiles: ReadonlyArray<AppProfileInfo> }) {
  const context = RouterContext.useRouterContext()
  const authed = useRouteContext({ from: "/_authed" })
  const navigate = useNavigate()
  const catalog = Apps.useCatalog()
  const space = useQuery(context.api.space.get.queryOptions({ idOrSlug: props.spaceId }))
  const credentials = useQuery(context.api.credential.list.queryOptions(Apps.page))
  const [dialog, setDialog] = useState<Dialogs>()
  const apps = new Map(catalog.entries.map((entry) => [entry.id, entry]))
  const byApp = [...Map.groupBy(props.profiles, (profile) => profile.appId)]
  const loose = (credentials.data?.items ?? []).filter(
    (credential) => credential.owner.kind === "space" && credential.owner.spaceId === props.spaceId,
  )
  const gaps = props.profiles.some((profile) => Profiles.gaps(profile).length > 0)
  const openApp = (appId: string) =>
    void navigate({ to: "/spaces/$spaceId/apps", params: { spaceId: props.spaceId }, search: { app: appId } })
  const target = { id: props.spaceId, name: space.data?.name ?? "this space" }
  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          render={
            <Select.Button appearance="plain" size="medium" label={`Apps and credentials of ${target.name}`}>
              {byApp.length > 0 ? (
                <Avatar.Group
                  size="small"
                  items={byApp.map(([appId, group]) => ({
                    key: appId,
                    name: apps.get(appId)?.name ?? group[0]?.appSlug ?? appId,
                    image: apps.get(appId)?.icon,
                  }))}
                />
              ) : (
                "Connect"
              )}
              {gaps ? <StatusDot tone="warning" label="Not connected" /> : null}
            </Select.Button>
          }
        />
        <Menu.Popup placement="top" alignment="start" width="small">
          <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger
              icon={<Icon glyph="LayoutGrid" />}
              detail={<Count count={byApp.length} attention={gaps} />}
            >
              Apps
            </Menu.SubmenuTrigger>
            <Menu.SubmenuPopup width="medium">
              {byApp.length === 0 ? <Menu.Message>No apps yet.</Menu.Message> : null}
              {byApp.map(([appId, group]) => (
                <AppMenu
                  key={appId}
                  app={apps.get(appId)}
                  profiles={group}
                  spaceId={props.spaceId}
                  onConnect={(profile) => setDialog({ kind: "profile", appId, profileId: profile.id })}
                  onNew={() => setDialog({ kind: "profile", appId })}
                  onOpen={() => openApp(appId)}
                />
              ))}
              <Menu.Separator />
              <Menu.Item icon={<Icon glyph="Plus" />} onSelect={() => setDialog({ kind: "add-app" })}>
                Add an app
              </Menu.Item>
            </Menu.SubmenuPopup>
          </Menu.SubmenuRoot>
          <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger
              icon={<Icon glyph="KeyRound" />}
              detail={<Count count={loose.length} attention={false} />}
            >
              Credentials
            </Menu.SubmenuTrigger>
            <Menu.SubmenuPopup width="medium">
              {loose.length === 0 ? <Menu.Message>No credentials yet.</Menu.Message> : null}
              {loose.map((credential) => (
                <Menu.Item
                  key={credential.id}
                  icon={<Icon glyph="KeyRound" />}
                  detail={reachOf(credential)}
                  onSelect={() =>
                    void navigate({ to: "/spaces/$spaceId/credentials", params: { spaceId: props.spaceId } })
                  }
                >
                  {credential.label}
                </Menu.Item>
              ))}
              <Menu.Separator />
              <Menu.Item icon={<Icon glyph="Plus" />} onSelect={() => setDialog({ kind: "credential" })}>
                Add credential
              </Menu.Item>
            </Menu.SubmenuPopup>
          </Menu.SubmenuRoot>
        </Menu.Popup>
      </Menu.Root>
      <StripDialogs
        dialog={dialog}
        space={target}
        kind={space.data?.kind}
        added={new Set(byApp.map(([appId]) => appId))}
        userId={authed.me.user.id}
        onChange={setDialog}
      />
    </>
  )
}

function StripDialogs(props: {
  dialog: Dialogs
  space: { readonly id: string; readonly name: string }
  kind: SpaceKind | undefined
  added: ReadonlySet<string>
  userId: string
  onChange: (dialog: Dialogs) => void
}) {
  const dialog = props.dialog
  const close = () => props.onChange(undefined)
  if (dialog?.kind === "add-app")
    return (
      <AddAppDialog
        space={props.space}
        added={props.added}
        onAdded={(added) => props.onChange({ kind: "profile", ...added })}
        onClose={close}
      />
    )
  if (dialog?.kind === "profile")
    return (
      <ProfileDialog
        appId={dialog.appId}
        {...(dialog.profileId && { profileId: dialog.profileId })}
        {...(props.kind && { from: { spaceId: props.space.id, kind: props.kind } })}
        onClose={close}
      />
    )
  if (dialog?.kind === "credential")
    return (
      <PasteCredentialDialog
        title={`Add credential to ${props.space.name}`}
        description="Every chat in this space can use it."
        owners={[{ value: `space:${props.space.id}`, label: props.space.name, glyph: "Cube" }]}
        userId={props.userId}
        submitLabel="Save credential"
        onClose={close}
      />
    )
  return null
}

const reachOf = (credential: CredentialInfo) =>
  credential.hosts.includes(Credential.anyHost) ? "Any website" : credential.hosts.join(", ")

function Count(props: { count: number; attention: boolean }) {
  if (props.count === 0) return null
  return (
    <span className="flex items-center gap-2">
      {props.count}
      {props.attention ? <StatusDot tone="warning" label="Not connected" /> : null}
    </span>
  )
}

function AppMenu(props: {
  app: Apps.Entry | undefined
  profiles: ReadonlyArray<AppProfileInfo>
  spaceId: string
  onConnect: (profile: AppProfileInfo) => void
  onNew: () => void
  onOpen: () => void
}) {
  const signIn = useSignIn()
  const name = props.app?.name ?? props.profiles[0]?.appSlug ?? ""
  const connect = (profile: AppProfileInfo) => {
    const missing = profile.items.filter((item) => !item.optional && item.status !== "ok")
    const only = missing.length === 1 ? missing[0] : undefined
    if (only && "mcp" in only.item && (only.kind === "oauth" || only.kind === "provider")) signIn.start(profile, only)
    else props.onConnect(profile)
  }
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger
        icon={
          <Avatar.Root name={name} image={props.app?.icon} size="small" shape="square" imageFit="contain" decorative />
        }
        detail={
          props.profiles.some((profile) => Profiles.gaps(profile).length > 0) ? (
            <StatusDot tone="warning" label="Not connected" />
          ) : undefined
        }
      >
        {name}
      </Menu.SubmenuTrigger>
      <Menu.SubmenuPopup width="medium">
        <Menu.Section label="Accounts">
          {props.profiles.map((profile) => {
            const missing = Profiles.gaps(profile).length > 0
            return (
              <Menu.Item
                key={profile.id}
                icon={missing ? <StatusDot tone="warning" frame="icon" /> : <Icon glyph="Check" />}
                detail={Apps.caption(profile, props.spaceId)}
                onSelect={() => (missing ? connect(profile) : props.onOpen())}
              >
                {profile.name}
              </Menu.Item>
            )
          })}
        </Menu.Section>
        <Menu.Separator />
        <Menu.Item icon={<Icon glyph="Plus" />} onSelect={props.onNew}>
          New account
        </Menu.Item>
        <Menu.Item icon={<Icon glyph="ArrowUpRight" />} onSelect={props.onOpen}>
          Open in space
        </Menu.Item>
      </Menu.SubmenuPopup>
    </Menu.SubmenuRoot>
  )
}
