import type { AppProfileInfo, CredentialInfo, SpaceKind } from "@ren/client"
import { Credential } from "@ren/schema/credential"
import { Avatar, AvatarFallback, AvatarGroup, AvatarImage } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Icon } from "@ren/ui/icon"
import type { Glyph } from "@ren/ui/icon"
import { StatusDot } from "@ren/ui/status-dot"
import { Initials } from "@ren/util/initials"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useRouteContext } from "@tanstack/react-router"
import { useState } from "react"
import type { ReactNode } from "react"
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
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="sm" aria-label={`Apps and credentials of ${target.name}`} />}
        >
          {byApp.length > 0 ? (
            <AvatarGroup>
              {byApp.map(([appId, group]) => {
                const name = apps.get(appId)?.name ?? group[0]?.appSlug ?? appId
                return (
                  <Avatar key={appId} size="sm" className="size-5">
                    <AvatarImage src={apps.get(appId)?.icon} alt="" />
                    <AvatarFallback className="bg-secondary">{Initials.of(name)}</AvatarFallback>
                  </Avatar>
                )
              })}
            </AvatarGroup>
          ) : (
            "Connect"
          )}
          {gaps ? <StatusDot tone="warning" label="Not connected" /> : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-48">
          <Submenu
            glyph="LayoutGrid"
            label="Apps"
            count={byApp.length}
            attention={gaps}
            empty="No apps yet."
            addLabel="Add an app"
            onAdd={() => setDialog({ kind: "add-app" })}
          >
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
          </Submenu>
          <Submenu
            glyph="KeyRound"
            label="Credentials"
            count={loose.length}
            attention={false}
            empty="No credentials yet."
            addLabel="Add credential"
            onAdd={() => setDialog({ kind: "credential" })}
          >
            <DropdownMenuGroup>
              {loose.map((credential) => (
                <DropdownMenuItem
                  key={credential.id}
                  onClick={() =>
                    void navigate({ to: "/spaces/$spaceId/credentials", params: { spaceId: props.spaceId } })
                  }
                >
                  <Icon glyph="KeyRound" />
                  <span className="min-w-0 flex-1 truncate">{credential.label}</span>
                  <span className="max-w-1/2 shrink-0 truncate text-xs text-muted-foreground">
                    {reachOf(credential)}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </Submenu>
        </DropdownMenuContent>
      </DropdownMenu>
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

function Submenu(props: {
  glyph: Glyph
  label: string
  count: number
  attention: boolean
  empty: string
  addLabel: string
  onAdd: () => void
  children: ReactNode
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon glyph={props.glyph} />
        {props.label}
        {props.count === 0 ? null : (
          <span className="ml-auto flex items-center gap-2 text-muted-foreground">
            {props.count}
            {props.attention ? <StatusDot tone="warning" label="Not connected" /> : null}
          </span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64">
        {props.count === 0 ? <p className="px-2 py-1.5 text-sm text-muted-foreground">{props.empty}</p> : null}
        {props.children}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={props.onAdd}>
            <Icon glyph="Plus" />
            {props.addLabel}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
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
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Avatar size="sm" aria-hidden className="size-5 rounded-sm after:rounded-sm">
          <AvatarImage src={props.app?.icon} alt="" className="m-auto size-3/4 rounded-none object-contain" />
          <AvatarFallback className="rounded-sm">{Initials.of(name)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {props.profiles.some((profile) => Profiles.gaps(profile).length > 0) ? (
          <StatusDot tone="warning" label="Not connected" />
        ) : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Accounts</DropdownMenuLabel>
          {props.profiles.map((profile) => {
            const missing = Profiles.gaps(profile).length > 0
            return (
              <DropdownMenuItem key={profile.id} onClick={() => (missing ? connect(profile) : props.onOpen())}>
                {missing ? <StatusDot tone="warning" frame="icon" /> : <Icon glyph="Check" />}
                <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                <span className="max-w-1/2 shrink-0 truncate text-xs text-muted-foreground">
                  {Apps.caption(profile, props.spaceId)}
                </span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={props.onNew}>
            <Icon glyph="Plus" />
            New account
          </DropdownMenuItem>
          <DropdownMenuItem onClick={props.onOpen}>
            <Icon glyph="ArrowUpRight" />
            Open in space
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
