import { useState } from "react"
import { IconMessagePlus, IconPlus } from "@tabler/icons-react"
import { Composer, Mentions } from "@ren/chat"
import { Button } from "@ren/ui/button"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@ren/ui/breadcrumb"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { AddToSpace, type Added } from "../../components/add-to-space.js"
import { AppIcon } from "../../components/app-icon.js"
import { AccountList, AppSections } from "../../components/app-list.js"
import { EmptyState } from "../../components/empty-state.js"
import { PageSkeleton } from "../../components/page.js"
import { ProfileDialog, type ProfileTarget } from "../../components/profile-dialog.js"
import { Drafts } from "../../lib/drafts.js"
import { useApp } from "../../lib/use-app.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { useAppProfiles } from "../../lib/use-app-profiles.js"
import { audience, connectLabel, fromRegistry, gaps, listsSpace, type CatalogApp } from "../../lib/apps.js"
import { RouterContext } from "../../lib/router-context.js"

const route = getRouteApi("/_authed/_shell/apps/$appId/")

type Space = ReturnType<typeof useSpaces>["joined"][number]

const withoutMention = (prompt: string) => prompt.replace(/^@\S+\s*/u, "")

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

function useConnectedSpaces(app: CatalogApp) {
  const joined = useSpaces().joined
  const ready = useAppProfiles([app.id])
    .of(app.id)
    .filter((profile) => gaps(profile).length === 0)
  return joined.filter((space) =>
    ready.some((profile) => (profile.kind === "private" ? space.kind === "private" : listsSpace(profile, space.id))),
  )
}

function useStartChat(app: CatalogApp) {
  const navigate = useNavigate()
  const write = Drafts.useWrite()
  return (spaceId: string, prompt = "") => {
    const mention: Composer.MentionedApp = {
      id: app.id,
      slug: app.slug,
      name: app.name,
      description: app.description,
      icon: app.icon,
      brandColor: app.brandColor,
    }
    const text = `${Mentions.text({ label: app.name })} ${withoutMention(prompt)}`
    write(Drafts.space(spaceId), Composer.withMention(Composer.withText(Composer.empty, text), mention))
    void navigate({ to: "/", search: { spaceId } })
  }
}

function StartChat(props: { spaces: ReadonlyArray<Space>; onStart: (spaceId: string) => void }) {
  const only = props.spaces.length === 1 ? props.spaces[0] : undefined
  if (only)
    return (
      <Button onClick={() => props.onStart(only.id)}>
        <IconMessagePlus data-icon="inline-start" />
        Start chat
      </Button>
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button />}>
        <IconMessagePlus data-icon="inline-start" />
        Start chat
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Start a chat in</DropdownMenuLabel>
          {props.spaces.map((space) => (
            <DropdownMenuItem key={space.id} onClick={() => props.onStart(space.id)}>
              {space.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ExamplePrompts(props: { app: CatalogApp; onStart: ((prompt: string) => void) | undefined }) {
  const prompts = props.app.listing?.examplePrompts ?? []
  if (prompts.length === 0) return null
  const start = props.onStart
  return (
    <section aria-label="Example prompts" className="grid gap-3 sm:grid-cols-3">
      {prompts.slice(0, 3).map((prompt) => {
        const body = (
          <>
            <span className="font-medium text-foreground">@{props.app.name}</span> {withoutMention(prompt)}
          </>
        )
        return start ? (
          <Button
            key={prompt}
            variant="ghost"
            onClick={() => start(prompt)}
            className="h-auto justify-start rounded-xl bg-muted/60 p-4 text-left text-sm/5 font-normal whitespace-normal text-muted-foreground hover:bg-muted active:not-aria-[haspopup]:scale-none"
          >
            {body}
          </Button>
        ) : (
          <p key={prompt} className="rounded-xl bg-muted/60 p-4 text-sm/5 text-muted-foreground">
            {body}
          </p>
        )
      })}
    </section>
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
  const connected = useConnectedSpaces(app)
  const start = useStartChat(app)
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
  const first = connected.at(0)
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
            {connected.length > 0 ? (
              <>
                <StartChat spaces={connected} onStart={(spaceId) => start(spaceId)} />
                <AddToSpace app={app} onAdded={added} />
              </>
            ) : (
              <AddToSpace app={app} primary onAdded={added} />
            )}
          </div>
        </div>
      </header>
      <ExamplePrompts app={app} onStart={first ? (prompt) => start(first.id, prompt) : undefined} />
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
