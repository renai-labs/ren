import { useState } from "react"
import { IconPlus } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@ren/ui/breadcrumb"
import { AddToSpace, type Added } from "../../components/add-to-space.js"
import { AppIcon } from "../../components/app-icon.js"
import { AccountList, AppSections } from "../../components/app-list.js"
import { EmptyState } from "../../components/empty-state.js"
import { PageSkeleton } from "../../components/page.js"
import { ProfileDialog, type ProfileTarget } from "../../components/profile-dialog.js"
import { useApp } from "../../lib/use-app.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { useAppProfiles } from "../../lib/use-app-profiles.js"
import { audience, connectLabel, fromRegistry, type CatalogApp } from "../../lib/apps.js"
import { RouterContext } from "../../lib/router-context.js"

const route = getRouteApi("/_authed/_shell/apps/$appId/")

function AppAccounts(props: { appId: string; onProfile: (target: ProfileTarget) => void }) {
  const profiles = useAppProfiles([props.appId]).of(props.appId)
  return (
    <AccountList
      title="Accounts"
      actions={
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => props.onProfile({ appId: props.appId })}
        >
          <IconPlus />
          New account
        </Button>
      }
      profiles={profiles}
      caption={audience}
      onOpen={(each) => props.onProfile({ appId: each.appId, profileId: each.id, edit: true })}
      action={(each) => {
        const label = connectLabel(each)
        return label ? (
          <Button size="sm" onClick={() => props.onProfile({ appId: each.appId, profileId: each.id })}>
            {label}
          </Button>
        ) : null
      }}
    />
  )
}

function AppsBreadcrumb(props: { name: string }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link to="/apps" />}>Apps</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{props.name}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function AppDetail(props: { app: CatalogApp }) {
  const app = props.app
  const spaces = useSpaces()
  const [profile, setProfile] = useState<ProfileTarget>()
  const added: Added = (added) =>
    setProfile({
      appId: added.app.id,
      profileId: added.profileId,
      from: {
        spaceId: added.space.id,
        name: added.space.name,
        members: spaces.space(added.space.id)?.memberCount ?? 1,
      },
    })
  const body = app.listing?.body
  return (
    <div className="mx-auto flex w-full max-w-200 flex-1 flex-col gap-10 px-6 pt-8 pb-12">
      <AppsBreadcrumb name={app.name} />
      <header className="flex flex-col gap-5">
        <AppIcon
          name={app.name}
          description={app.description}
          icon={app.icon}
          className="size-16 rounded-2xl shadow-sm ring-1 ring-border"
        />
        <div className="flex items-end justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-2xl font-medium tracking-tight">{app.name}</h1>
            <p className="text-muted-foreground">{app.description}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <AddToSpace app={app} primary onAdded={added} />
          </div>
        </div>
      </header>
      {body && body !== app.description ? (
        <p className="text-sm/6 whitespace-pre-line text-muted-foreground">{body}</p>
      ) : null}
      <AppAccounts appId={app.id} onProfile={setProfile} />
      <AppSections app={app} />
      {profile ? <ProfileDialog {...profile} onClose={() => setProfile(undefined)} /> : null}
    </div>
  )
}

export function AppPage() {
  const appId = route.useParams().appId
  const { api } = RouterContext.useRouterContext()
  const found = useApp(appId)
  const registry = useQuery({ ...api["app-registry"].get.queryOptions({ idOrSlug: appId }), retry: false })
  const listed = registry.data ? fromRegistry(registry.data) : undefined
  const app =
    found.app && listed && !found.app.listing ? { ...found.app, listing: listed.listing } : (found.app ?? listed)
  if (!app && (found.pending || registry.isPending)) return <PageSkeleton title="Loading app" />
  if (!app)
    return (
      <div className="mx-auto flex w-full max-w-200 flex-1 flex-col gap-10 px-6 pt-8 pb-12">
        <AppsBreadcrumb name="Not found" />
        <h1 className="text-2xl font-medium tracking-tight">App not found</h1>
        <EmptyState>This app does not exist or was removed.</EmptyState>
      </div>
    )
  return <AppDetail app={app} />
}
