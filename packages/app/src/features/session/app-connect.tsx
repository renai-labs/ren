import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { IconChevronDown, IconRosetteDiscountCheckFilled } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { Loading } from "@ren/ui/loading"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { toast } from "@ren/ui/sonner"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { errorMessage } from "../../lib/errors.js"
import { AppIcon } from "../../components/app-icon.js"
import { ProfileDialog, type ProfileTarget } from "../../components/profile-dialog.js"
import type { AppProfileInfo as AppProfile } from "@ren/client"
import { gaps, type CatalogApp } from "../../lib/apps.js"
import { plural } from "../../lib/format.js"
import { useApps } from "../../lib/use-app.js"
import { useAppProfiles } from "../../lib/use-app-profiles.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { RouterContext } from "../../lib/router-context.js"

function UseHere(props: { elsewhere: ReadonlyArray<AppProfile>; onUse: (profile: AppProfile) => void }) {
  const first = props.elsewhere.at(0)
  if (!first) return null
  if (props.elsewhere.length === 1)
    return (
      <Button size="sm" className="shrink-0" disabled={!first.canAccess} onClick={() => props.onUse(first)}>
        Use here
      </Button>
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" className="shrink-0" />}>
        Use here
        <IconChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Use an account from another space</DropdownMenuLabel>
          {props.elsewhere.map((profile) => (
            <DropdownMenuItem key={profile.id} disabled={!profile.canAccess} onClick={() => props.onUse(profile)}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{profile.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {profile.canAccess
                    ? `In ${profile.spaces.map((space) => space.name).join(", ") || "no space"}`
                    : "Ask its owner or an admin"}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type CardProps = {
  app: Pick<CatalogApp, "name" | "icon" | "source">
  connected: number
  elsewhere: ReadonlyArray<AppProfile>
  onConnect: () => void
  onAdd: () => void
  onManage: () => void
  onUse: (profile: AppProfile) => void
}

function caption(props: CardProps) {
  if (props.connected > 0) return `Connected · ${plural(props.connected, "account")}`
  const spaces = [...new Set(props.elsewhere.flatMap((profile) => profile.spaces.map((space) => space.name)))]
  if (props.elsewhere.length === 0) return `Let Ren use ${props.app.name}`
  return spaces.length === 1 ? `Connected in ${spaces[0]}` : `Connected in ${plural(spaces.length, "other space")}`
}

function CardActions(props: CardProps) {
  if (props.connected > 0)
    return (
      <span className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={props.onAdd}>
          Add account
        </Button>
        <Button variant="secondary" size="sm" onClick={props.onManage}>
          Manage
        </Button>
      </span>
    )
  if (props.elsewhere.length > 0)
    return (
      <span className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={props.onConnect}>
          Connect new
        </Button>
        <UseHere elsewhere={props.elsewhere} onUse={props.onUse} />
      </span>
    )
  return (
    <Button size="sm" className="shrink-0" onClick={props.onConnect}>
      Connect
    </Button>
  )
}

function ConnectCard(props: CardProps) {
  return (
    <div className="flex w-full max-w-lg items-center gap-3 rounded-xl border bg-card p-3">
      <AppIcon name={props.app.name} icon={props.app.icon} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1 font-medium">
          <span className="truncate">{props.app.name}</span>
          {props.app.source === "registry" ? (
            <IconRosetteDiscountCheckFilled aria-label="Verified" className="size-4 shrink-0 text-chart-1" />
          ) : null}
        </span>
        <span className="truncate text-sm text-muted-foreground">{caption(props)}</span>
      </div>
      <CardActions {...props} />
    </div>
  )
}

function useUseHere(space: { id: string; name: string; kind: string; memberCount: number } | undefined) {
  const { api } = RouterContext.useRouterContext()
  const spaces = useSpaces().spaces
  const promote = useMutation(api["app-profile"].promote.mutationOptions())
  const access = useMutation(api["app-profile"].access.mutationOptions())
  const [widening, setWidening] = useState<AppProfile>()
  const privateSpace = (id: string) => spaces.find((each) => each.id === id)?.kind === "private"
  const widens = (profile: AppProfile) =>
    space?.kind !== "private" && (profile.kind === "private" || profile.spaces.every((each) => privateSpace(each.id)))
  const apply = (profile: AppProfile, into: { id: string; name: string }) =>
    (profile.kind === "private"
      ? promote.mutateAsync({ id: profile.id, spaceId: into.id })
      : access.mutateAsync({ id: profile.id, add: [into.id] })
    ).then(
      () => toast.success(`${profile.name} is now in ${into.name}`),
      (error: unknown) => toast.error("Couldn’t use the account here", { description: errorMessage(error) }),
    )
  return {
    onUse: (profile: AppProfile) => {
      if (!space) return
      if (widens(profile)) setWidening(profile)
      else void apply(profile, space)
    },
    dialog: space ? (
      <ConfirmDialog
        open={widening !== undefined}
        onOpenChange={(open) => (open ? undefined : setWidening(undefined))}
        confirmation={{
          title: `Use ${widening?.name ?? "this account"} in ${space.name}?`,
          description: `Everyone in ${space.name} (${plural(space.memberCount, "person", "people")}) will be able to use ${widening?.name ?? "it"}.`,
          action: "Use here",
        }}
        onConfirm={() => (widening ? apply(widening, space) : undefined)}
      />
    ) : null,
  }
}

function ConnectCards(props: { appIds: ReadonlyArray<string>; spaceId: string | undefined; always?: boolean }) {
  const catalog = useApps(props.appIds)
  if (catalog.pending)
    return (
      <Loading label="Loading app">
        <ConnectCard
          app={{ name: "App", icon: null, source: "custom" }}
          connected={0}
          elsewhere={[]}
          onConnect={() => undefined}
          onAdd={() => undefined}
          onManage={() => undefined}
          onUse={() => undefined}
        />
      </Loading>
    )
  return (
    <ConnectList
      apps={props.appIds.flatMap((appId) => catalog.of(appId) ?? [])}
      spaceId={props.spaceId}
      always={props.always}
    />
  )
}

function ConnectList(props: {
  apps: ReadonlyArray<CatalogApp>
  spaceId: string | undefined
  always?: boolean | undefined
}) {
  const { api } = RouterContext.useRouterContext()
  const apps = props.apps
  const others = useAppProfiles(apps.map((app) => app.id))
  const spaces = useSpaces().spaces
  const space = spaces.find((each) => each.id === props.spaceId)
  const reach = useQuery({
    ...api["app-profile-reach"].space.profiles.queryOptions({ id: props.spaceId ?? "" }),
    enabled: props.spaceId !== undefined && apps.length > 0,
    retry: false,
  })
  const reuse = useUseHere(space)
  const [watched, setWatched] = useState<ReadonlySet<string>>()
  const [target, setTarget] = useState<ProfileTarget>()
  const profiles = reach.data?.profiles ?? []
  const ready = (appId: string) => profiles.filter((profile) => profile.appId === appId && gaps(profile).length === 0)
  if (reach.isSuccess && watched === undefined)
    setWatched(new Set(apps.filter((app) => props.always || ready(app.id).length === 0).map((app) => app.id)))
  const shown = apps.filter((app) => watched?.has(app.id))
  if (!space || shown.length === 0) return null
  const from = {
    spaceId: space.id,
    name: space.name,
    members: space.memberCount,
    private: space.kind === "private",
  }
  const missingOf = (appId: string) =>
    profiles.find((profile) => profile.appId === appId && gaps(profile).length > 0)?.id
  const here = new Set(profiles.map((profile) => profile.id))
  const elsewhere = (appId: string) =>
    others
      .of(appId)
      .filter((profile) => !here.has(profile.id) && gaps(profile).length === 0)
      .toSorted((a, b) => Number(b.canAccess) - Number(a.canAccess))
  return (
    <div className="flex flex-col gap-3">
      {shown.map((app) => (
        <ConnectCard
          key={app.id}
          app={app}
          connected={ready(app.id).length}
          elsewhere={elsewhere(app.id)}
          onConnect={() => setTarget({ appId: app.id, profileId: missingOf(app.id), from })}
          onAdd={() => setTarget({ appId: app.id, from })}
          onManage={() => setTarget({ appId: app.id, profileId: ready(app.id).at(0)?.id, from, edit: true })}
          onUse={reuse.onUse}
        />
      ))}
      {target ? <ProfileDialog {...target} onClose={() => setTarget(undefined)} /> : null}
      {reuse.dialog}
    </div>
  )
}

export function AppConnectCard(props: { appId: string; spaceId: string }) {
  return <ConnectCards appIds={[props.appId]} spaceId={props.spaceId} always />
}
