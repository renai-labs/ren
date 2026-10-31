import type { AppProfileInfo, SpaceKind } from "@ren/client"
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@ren/ui/popover"
import { Separator } from "@ren/ui/separator"
import { Initials } from "@ren/util/initials"
import { IconApps, IconPlus } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { useRouteContext } from "@tanstack/react-router"
import { useState } from "react"
import { RouterContext } from "../lib/router-context.js"
import { useSignIn } from "./account-actions.js"
import { AddAppDialog } from "./add-app-dialog.js"
import { Apps } from "./apps.js"
import { ProfileDialog } from "./profile-dialog.js"
import { Profiles } from "./profiles.js"

// oxlint-disable-next-line ren/no-comments -- profiles.md P15: the apps a chat reaches, each account with what is missing and a Connect button.
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
  | undefined

function Strip(props: { spaceId: string; profiles: ReadonlyArray<AppProfileInfo> }) {
  const context = RouterContext.useRouterContext()
  const authed = useRouteContext({ from: "/_authed" })
  const catalog = Apps.useCatalog()
  const signIn = useSignIn()
  const space = useQuery(context.api.space.get.queryOptions({ idOrSlug: props.spaceId }))
  const [dialog, setDialog] = useState<Dialogs>()
  const [open, setOpen] = useState(false)
  const apps = new Map(catalog.entries.map((entry) => [entry.id, entry]))
  const rows = props.profiles.map((profile) => ({
    profile,
    app: apps.get(profile.appId)?.name ?? profile.appSlug,
    icon: apps.get(profile.appId)?.icon ?? undefined,
    gaps: Profiles.gaps(profile).map((gap) => gap.name),
  }))
  const stack = [...new Map(rows.map((row) => [row.app, row.icon] as const))]
  const shown = stack.slice(0, 3)
  const missing = rows.filter((row) => row.gaps.length > 0).length
  const target = { id: props.spaceId, name: space.data?.name ?? "this space" }
  const connect = (profile: AppProfileInfo) => {
    const left = profile.items.filter((item) => !item.optional && item.status !== "ok")
    const only = left.length === 1 ? left[0] : undefined
    if (only && "mcp" in only.item && (only.kind === "oauth" || only.kind === "provider")) signIn.start(profile, only)
    else setDialog({ kind: "profile", appId: profile.appId, profileId: profile.id })
  }
  const dialogs = (
    <StripDialogs
      dialog={dialog}
      space={target}
      kind={space.data?.kind}
      added={new Set(rows.map((row) => row.profile.appId))}
      userId={authed.me.user.id}
      onChange={setDialog}
    />
  )
  if (rows.length === 0)
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-1 font-normal text-muted-foreground"
          onClick={() => setDialog({ kind: "add-app" })}
        >
          <IconApps />
          Add apps
        </Button>
        {dialogs}
      </>
    )
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="-ml-1 font-normal"
              aria-label={`Apps: ${stack.map((entry) => entry[0]).join(", ")}${missing ? `, ${missing} not connected` : ""}`}
            />
          }
        >
          <AvatarGroup className="-space-x-1.5 *:data-[slot=avatar]:ring-card *:data-[slot=avatar-group-count]:ring-card">
            {shown.map((entry) => (
              <Avatar key={entry[0]} size="sm" className="size-5">
                <AvatarImage src={entry[1]} alt="" />
                <AvatarFallback className="bg-secondary">{Initials.of(entry[0])}</AvatarFallback>
              </Avatar>
            ))}
            {stack.length > shown.length ? (
              <AvatarGroupCount className="size-5 text-2xs">+{stack.length - shown.length}</AvatarGroupCount>
            ) : null}
          </AvatarGroup>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-80 gap-0 p-1">
          <PopoverTitle className="sr-only">Apps this chat can use</PopoverTitle>
          {rows.map((row) => (
            <div key={row.profile.id} className="flex items-center gap-3 rounded-sm p-2">
              <Avatar size="sm" className="size-5">
                <AvatarImage src={row.icon} alt="" />
                <AvatarFallback className="bg-secondary">{Initials.of(row.app)}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">
                  {row.app} · {row.profile.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {row.gaps.length ? row.gaps.join(", ") : "Connected"}
                </span>
              </div>
              {row.gaps.length ? (
                <Button variant="secondary" size="sm" onClick={() => connect(row.profile)}>
                  Connect
                </Button>
              ) : null}
            </div>
          ))}
          <Separator className="my-1" />
          <Button
            variant="ghost"
            className="justify-start gap-3 px-2 font-normal text-muted-foreground"
            onClick={() => {
              setOpen(false)
              setDialog({ kind: "add-app" })
            }}
          >
            <IconPlus />
            Add more apps
          </Button>
        </PopoverContent>
      </Popover>
      {dialogs}
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
  return null
}
