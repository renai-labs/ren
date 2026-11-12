import { lazy, Suspense, useState } from "react"
import { IconArrowRight, IconMessagePlus, IconPlus } from "@tabler/icons-react"
import { Composer, Mentions } from "@ren/chat"
import { AppMention } from "@ren/ui/app-mention"
import { Button } from "@ren/ui/button"
import { cn } from "cn"
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
import { PageSkeleton, pageWidths } from "../../components/page.js"
import { ProfileDialog, type ProfileTarget } from "../../components/profile-dialog.js"
import { Drafts } from "../../lib/drafts.js"
import { useApp } from "../../lib/use-app.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { useAppProfiles } from "../../lib/use-app-profiles.js"
import { audience, connectLabel, fromRegistry, gaps, listsSpace, type CatalogApp } from "../../lib/apps.js"
import { ReducedMotion } from "../../lib/reduced-motion.js"
import { RouterContext } from "../../lib/router-context.js"

const route = getRouteApi("/_authed/_shell/apps/$appId/")

const MeshGradient = lazy(() =>
  import("@paper-design/shaders-react").then((module) => ({ default: module.MeshGradient })),
)

const promptColors = ["#78cbea", "#a6def2", "#d5eff8", "#72bdea", "#83d2b4", "#d9f3e7"]

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
  const isReduced = ReducedMotion.use()
  const prompts = props.app.listing?.examplePrompts ?? []
  if (prompts.length === 0) return null
  const start = props.onStart
  return (
    <section
      aria-label="Example prompts"
      className="relative isolate grid min-h-64 overflow-hidden rounded-2xl bg-muted px-4 py-12 sm:min-h-80 sm:px-12"
    >
      <Suspense fallback={null}>
        <MeshGradient
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 size-full"
          width="100%"
          height="100%"
          colors={promptColors}
          distortion={0.34}
          swirl={0.22}
          grainMixer={0.01}
          grainOverlay={0.035}
          speed={isReduced ? 0 : 0.06}
          scale={1.2}
          rotation={18}
        />
      </Suspense>
      <ul className="m-auto flex w-full max-w-xl flex-col gap-3">
        {prompts.map((prompt) => {
          const body = (
            <span className="min-w-0 flex-1">
              <AppMention app={props.app} /> {withoutMention(prompt)}
            </span>
          )
          return (
            <li key={prompt}>
              {start ? (
                <Button
                  variant="ghost"
                  onClick={() => start(prompt)}
                  className="group/prompt h-auto w-full justify-between gap-3 rounded-2xl bg-white/70 py-2 pr-2 pl-4 text-left text-sm/6 font-normal whitespace-normal text-neutral-900 backdrop-blur-xl hover:bg-white/85 active:not-aria-[haspopup]:scale-none sm:pl-5 sm:text-base/7"
                >
                  {body}
                  <span
                    aria-hidden
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-white/70 transition-transform duration-150 ease-out group-hover/prompt:translate-x-0.5"
                  >
                    <IconArrowRight data-icon="inline-end" />
                  </span>
                </Button>
              ) : (
                <p className="flex rounded-2xl bg-white/70 px-4 py-3 text-sm/6 text-neutral-900 backdrop-blur-xl sm:px-5 sm:text-base/7">
                  {body}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function AppsBreadcrumb(props: { name: string }) {
  return (
    <div className="flex h-12 shrink-0 items-center px-3 pt-2 max-md:pl-11">
      <Breadcrumb className="flex h-8 items-center rounded-lg border bg-sidebar px-3">
        <BreadcrumbList className="gap-2">
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/apps" />}>Apps</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator className="text-muted-foreground">/</BreadcrumbSeparator>
          <BreadcrumbItem>
            <BreadcrumbPage>{props.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
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
    <div className="flex flex-1 flex-col">
      <AppsBreadcrumb name={app.name} />
      <div className={cn("mx-auto flex w-full flex-1 flex-col gap-10 px-6 pt-8 pb-12", pageWidths.column)}>
        <header className="flex items-center justify-between gap-6 max-sm:flex-col max-sm:items-start">
          <div className="flex min-w-0 items-center gap-4">
            <AppIcon
              name={app.name}
              description={app.description}
              icon={app.icon}
              className="size-16 rounded-2xl shadow-sm ring-1 ring-border"
            />
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="text-2xl font-medium tracking-tight">{app.name}</h1>
              <p className="text-sm/6 text-muted-foreground">{app.description}</p>
            </div>
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
        </header>
        <ExamplePrompts app={app} onStart={first ? (prompt) => start(first.id, prompt) : undefined} />
        {body && body !== app.description ? (
          <p className="text-sm/6 whitespace-pre-line text-muted-foreground">{body}</p>
        ) : null}
        <AppAccounts appId={app.id} onProfile={setProfile} />
        <AppSections app={app} />
        {profile ? <ProfileDialog {...profile} onClose={() => setProfile(undefined)} /> : null}
      </div>
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
      <div className="flex flex-1 flex-col">
        <AppsBreadcrumb name="Not found" />
        <div className={cn("mx-auto flex w-full flex-1 flex-col gap-10 px-6 pt-8 pb-12", pageWidths.column)}>
          <h1 className="text-2xl font-medium tracking-tight">App not found</h1>
          <EmptyState>This app does not exist or was removed.</EmptyState>
        </div>
      </div>
    )
  return <AppDetail app={app} />
}
