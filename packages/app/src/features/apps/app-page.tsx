import { Seed } from "@ren/client/react"
import { Fragment, lazy, Suspense, useState } from "react"
import {
  IconArchive,
  IconArrowRight,
  IconArrowsExchange,
  IconChevronDown,
  IconCube,
  IconDots,
  IconLock,
  IconPencil,
  IconPlus,
} from "@tabler/icons-react"
import { Composer, Mentions } from "@ren/chat"
import { AppMention } from "@ren/ui/app-mention"
import { Button } from "@ren/ui/button"
import type { AppRegistryInfo } from "@ren/client"
import { Loading } from "@ren/ui/loading"
import { useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Field, FieldError, FieldLabel } from "@ren/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { AppDetailFrame, AppDetailSample, AppDetailsSample, AppHeader } from "../../components/app-detail.js"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { CustomAppDialog } from "../../components/custom-app-dialog.js"
import { ReadMore } from "../../components/read-more.js"
import { errorMessage } from "../../lib/errors.js"
import { AccountList, AppSections } from "../../components/app-list.js"
import { EmptyState } from "../../components/empty-state.js"
import { useShapeId } from "../../components/page.js"
import { ProfileDialog, type ProfileTarget } from "../../components/profile-dialog.js"
import { Drafts } from "../../lib/drafts.js"
import { useApp } from "../../lib/use-app.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { useAppProfiles } from "../../lib/use-app-profiles.js"
import {
  categoryLabel,
  fromRegistry,
  hasManaged,
  isBundle,
  listsSpace,
  statusOf,
  type CatalogApp,
  type Status,
} from "../../lib/apps.js"
import { plural } from "../../lib/format.js"
import { ReducedMotion } from "../../lib/reduced-motion.js"
import { RouterContext } from "../../lib/router-context.js"
import { ShareRequest } from "./share-request.js"
import { DarkUi } from "../../lib/dark-ui.js"

const route = getRouteApi("/_authed/_shell/apps/$appId/")

const MeshGradient = lazy(() =>
  import("@paper-design/shaders-react").then((module) => ({ default: module.MeshGradient })),
)

const promptColors = ["#78cbea", "#a6def2", "#d5eff8", "#72bdea", "#83d2b4", "#d9f3e7"]

type Space = ReturnType<typeof useSpaces>["joined"][number]

const withoutMention = (prompt: string) => prompt.replace(/^@\S+\s*/u, "")

function AppAccounts(props: { app: CatalogApp; onProfile: (target: ProfileTarget) => void }) {
  const profiles = useAppProfiles([props.app.id]).of(props.app.id)
  return (
    <AccountList
      title="Accounts"
      app={props.app}
      actions={
        <Button size="sm" onClick={() => props.onProfile({ appId: props.app.id, newAccount: true })}>
          <IconPlus data-icon="inline-start" />
          New account
        </Button>
      }
      profiles={profiles}
      empty={
        isBundle(props.app)
          ? "Not in a space yet."
          : `No accounts yet. One account holds every sign-in and key ${props.app.name} needs.`
      }
      onOpen={(each) => props.onProfile({ appId: each.appId, profileId: each.id, edit: true })}
    />
  )
}

type SpaceUse = { space: Space; status: Status | undefined }

const works = (use: SpaceUse) => use.status === "connected" || use.status === "credits"

function useSpaceUses(app: CatalogApp): ReadonlyArray<SpaceUse> {
  const joined = useSpaces().joined
  const profiles = useAppProfiles([app.id]).of(app.id)
  return joined.map((space) => {
    const here = profiles.filter((profile) =>
      profile.kind === "private"
        ? space.kind === "private" && space.ownerUserId === profile.userId
        : listsSpace(profile, space.id),
    )
    return { space, status: here.length > 0 ? statusOf(app, here) : undefined }
  })
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

function OpenInChat(props: {
  app: CatalogApp
  uses: ReadonlyArray<SpaceUse>
  onStart: (spaceId: string) => void
  onProfile: (target: ProfileTarget) => void
}) {
  const isUsed = props.uses.some((use) => use.status)
  const open = (use: SpaceUse) => {
    if (works(use)) return props.onStart(use.space.id)
    props.onProfile({
      appId: props.app.id,
      from: {
        spaceId: use.space.id,
        name: use.space.name,
        members: use.space.memberCount,
        private: use.space.kind === "private",
      },
    })
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button />}>
        {isUsed ? "Open in chat" : "Add to space"}
        <IconChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-64">
        {[
          { label: "Chat in", uses: props.uses.filter((use) => use.status) },
          { label: "Add to", uses: props.uses.filter((use) => !use.status) },
        ]
          .filter((group) => group.uses.length > 0)
          .map((group, index) => (
            <Fragment key={group.label}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuGroup>
                <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                {group.uses.map((use) => (
                  <DropdownMenuItem key={use.space.id} onClick={() => open(use)}>
                    {use.space.kind === "private" ? <IconLock /> : <IconCube />}
                    <span className="min-w-0 flex-1 truncate">{use.space.name}</span>
                    <span className="text-xs text-muted-foreground">{actionOf(use)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </Fragment>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const actionOf = (use: SpaceUse) => {
  if (!use.status) return "Add"
  if (works(use)) return "Chat"
  return use.status === "expired" ? "Reconnect" : "Connect"
}

function OwnerSpaceField(props: {
  spaces: ReadonlyArray<{ id: string; name: string }>
  value: string | undefined
  problem: string | undefined
  onChange: (spaceId: string) => void
}) {
  const invalid = props.problem !== undefined || undefined
  return (
    <Field data-invalid={invalid}>
      <FieldLabel>Owner</FieldLabel>
      <Select
        items={props.spaces.map((space) => ({ value: space.id, label: space.name }))}
        value={props.value ?? null}
        onValueChange={(value) => {
          if (typeof value === "string") props.onChange(value)
        }}
      >
        <SelectTrigger aria-label="Owner" aria-invalid={invalid} className="w-full">
          <SelectValue placeholder="Choose a space" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {props.spaces.map((space) => (
              <SelectItem key={space.id} value={space.id}>
                {space.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {props.problem ? <FieldError>{props.problem}</FieldError> : null}
    </Field>
  )
}

const nameClash = (app: CatalogApp, space: { name: string } | undefined) =>
  space && space.name.trim().toLowerCase() === app.name.trim().toLowerCase()
    ? `An app cannot have the name of its space, “${space.name}”.`
    : undefined

function ChangeOwnerDialog(props: { app: CatalogApp; onClose: () => void }) {
  const { api } = RouterContext.useRouterContext()
  const spaces = useSpaces().joined.filter((space) => space.id !== props.app.ownerSpaceId)
  const move = useMutation(api.app.transferOwnership.mutationOptions())
  const [spaceId, setSpaceId] = useState(spaces.at(0)?.id)
  const target = spaces.find((space) => space.id === spaceId)
  const clash = nameClash(props.app, target)
  const failed = move.error ? errorMessage(move.error) : undefined
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            if (!target || clash) return
            move.mutate(
              { id: props.app.id, spaceId: target.id },
              {
                onSuccess: () => {
                  toast.success(`${target.name} now owns ${props.app.name}`)
                  props.onClose()
                },
              },
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>Change owner of {props.app.name}</DialogTitle>
            <DialogDescription>
              Members of the owner space can edit, archive and change the owner of the app.
            </DialogDescription>
          </DialogHeader>
          <OwnerSpaceField spaces={spaces} value={spaceId} problem={clash ?? failed} onChange={setSpaceId} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!target || clash !== undefined || move.isPending}>
              {move.isPending ? <Spinner data-icon="inline-start" /> : null}
              Change owner
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SearchDialogs(props: { app: CatalogApp; onChat: (spaceId: string) => void }) {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const close = () => void navigate({ search: {}, replace: true })
  if (search.connect) return <ProfileDialog appId={props.app.id} profileId={search.connect} onClose={close} />
  if (search.account && search.space)
    return (
      <ShareRequest
        app={props.app}
        account={search.account}
        space={search.space}
        onChat={props.onChat}
        onClose={close}
      />
    )
  return null
}

function OwnerActions(props: { app: CatalogApp; uses: ReadonlyArray<SpaceUse> }) {
  const app = props.app
  if (app.source !== "custom" || !props.uses.some((use) => use.space.id === app.ownerSpaceId)) return null
  return <OwnerMenu app={app} />
}

function OwnerMenu(props: { app: CatalogApp }) {
  const { api } = RouterContext.useRouterContext()
  const navigate = useNavigate()
  const archive = useMutation(api.app.archive.mutationOptions())
  const [open, setOpen] = useState<"edit" | "owner" | "archive">()
  const [chosen, setChosen] = useState<"edit" | "owner" | "archive">()
  const app = props.app
  return (
    <>
      <DropdownMenu
        onOpenChangeComplete={(isOpen) => {
          if (isOpen || !chosen) return
          setOpen(chosen)
          setChosen(undefined)
        }}
      >
        <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label={`More for ${app.name}`} />}>
          <IconDots />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setChosen("edit")}>
              <IconPencil />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setChosen("owner")}>
              <IconArrowsExchange />
              Change owner
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={() => setChosen("archive")}>
              <IconArchive />
              Archive app
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {open === "edit" ? <CustomAppDialog appId={app.id} onClose={() => setOpen(undefined)} /> : null}
      {open === "owner" ? <ChangeOwnerDialog app={app} onClose={() => setOpen(undefined)} /> : null}
      <ConfirmDialog
        open={open === "archive"}
        onOpenChange={(isOpen) => setOpen(isOpen ? "archive" : undefined)}
        confirmation={{
          title: `Archive ${app.name}?`,
          description: `Every space that uses ${app.name} loses its tools and skills, and its accounts stop working.`,
          action: "Archive app",
          working: "Archiving…",
        }}
        onConfirm={() =>
          archive.mutateAsync(
            { id: app.id },
            {
              onSuccess: () => {
                toast.success(`${app.name} archived`)
                void navigate({ to: "/apps", search: { tab: "organization" } })
              },
              onError: (error) => toast.error(`Couldn’t archive ${app.name}`, { description: errorMessage(error) }),
            },
          )
        }
      />
    </>
  )
}

function ExamplePrompts(props: {
  app: CatalogApp
  added?: boolean | undefined
  onStart: ((prompt: string) => void) | undefined
}) {
  const isReduced = ReducedMotion.useReduced()
  const deep = DarkUi.useDarkUi()
  const prompts = props.app.listing?.examplePrompts ?? []
  if (prompts.length === 0) return null
  const start = props.onStart
  if (deep)
    return (
      <section data-slot="app-prompts">
        <div data-slot="app-section-head">
          <h2 data-slot="app-prompts-title">Try it</h2>
          {start ? null : (
            <p data-slot="app-section-note">
              {props.added ? "Connect an account to try these" : "Add to a space to try these"}
            </p>
          )}
        </div>
        <ul data-slot="app-prompts-list">
          {prompts.map((prompt) => {
            const text = (
              <span data-slot="app-prompt-text">
                <AppMention app={props.app} /> {withoutMention(prompt)}
              </span>
            )
            return (
              <li key={prompt}>
                {start ? (
                  <button type="button" data-slot="app-prompt" onClick={() => start(prompt)}>
                    {text}
                    <span aria-hidden data-slot="app-prompt-go">
                      <IconArrowRight />
                    </span>
                  </button>
                ) : (
                  <p data-slot="app-prompt">{text}</p>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    )
  return (
    <section
      aria-label="Example prompts"
      data-slot="app-prompts"
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

function AppMeta(props: { app: CatalogApp }) {
  const app = props.app
  const spaceName = useSpaces().spaceName
  const mcps = Object.values(app.mcps ?? {}).filter((mcp) => mcp.transport.type !== "managed")
  const tools = Object.values(app.listing?.toolCounts ?? {}).reduce((total, count) => total + count, 0)
  const skills = Object.keys(app.skills ?? {}).length
  const items = [
    app.source === "registry" ? "Ren registry" : `Made in ${spaceName(app.ownerSpaceId)}`,
    [...new Set(Object.values(app.listing?.categories ?? {}).flat())].map(categoryLabel).join(", "),
    hasManaged(app) ? "Managed by Ren" : "",
    mcps.some((mcp) => mcp.auth.type === "oauth" || mcp.transport.type === "provider") ? "OAuth sign-in" : "",
    mcps.some((mcp) => mcp.auth.type !== "none" && mcp.auth.type !== "oauth") ? "API key" : "",
    tools > 0 ? plural(tools, "tool") : "",
    tools === 0 && mcps.length > 0 ? plural(mcps.length, "MCP") : "",
    skills > 0 ? plural(skills, "skill") : "",
  ].filter((item) => item !== "")
  return (
    <ul data-slot="app-header-meta" aria-label={`About ${app.name}`}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

function AppDetail(props: { app: CatalogApp; loading: boolean }) {
  const app = props.app
  const uses = useSpaceUses(app)
  const start = useStartChat(app)
  const [editing, setEditing] = useState<ProfileTarget>()
  const headerShape = useShapeId("app-header")
  const detailsShape = useShapeId("app-details")
  const first = uses.find(works)?.space
  const body = app.listing?.body
  const deep = DarkUi.useDarkUi()
  const actions = (
    <>
      <OwnerActions app={app} uses={uses} />
      <OpenInChat app={app} uses={uses} onStart={(spaceId) => start(spaceId)} onProfile={setEditing} />
    </>
  )
  const prompts = (
    <ExamplePrompts
      app={app}
      added={uses.some((use) => use.status)}
      onStart={first ? (prompt) => start(first.id, prompt) : undefined}
    />
  )
  const about =
    body && body !== app.description ? (
      <ReadMore className="text-sm/6 whitespace-pre-line text-muted-foreground">{body}</ReadMore>
    ) : null
  return (
    <AppDetailFrame name={app.name}>
      <Loading id={headerShape} loading={false} label="Loading app">
        <AppHeader
          name={app.name}
          description={app.description}
          icon={app.icon}
          actions={actions}
          meta={deep && !props.loading ? <AppMeta app={app} /> : undefined}
        />
      </Loading>
      <Loading id={detailsShape} loading={props.loading} label="Loading app details">
        {props.loading ? (
          <AppDetailsSample />
        ) : (
          <div data-slot="app-sections" className="flex flex-col gap-10">
            {deep ? about : prompts}
            {deep ? prompts : about}
            <AppAccounts app={app} onProfile={setEditing} />
            <AppSections app={app} facts={!deep} />
          </div>
        )}
      </Loading>
      {editing ? <ProfileDialog {...editing} onClose={() => setEditing(undefined)} /> : null}
      {editing || props.loading ? null : <SearchDialogs app={app} onChat={(spaceId) => start(spaceId)} />}
    </AppDetailFrame>
  )
}

export function AppPage() {
  const appId = route.useParams().appId
  const { api, queryClient } = RouterContext.useRouterContext()
  const found = useApp(appId)
  const registry = useQuery({
    ...api["app-registry"].get.queryOptions({ idOrSlug: appId }),
    ...Seed.fromList<AppRegistryInfo>(queryClient, [api["app-registry"].list.queryKey().slice(0, 1)], appId),
    retry: false,
  })
  const listed = registry.data && fromRegistry(registry.data)
  const app = found.app ? { ...found.app, listing: listed?.listing ?? found.app.listing } : listed
  if (!app && (found.pending || registry.isPending)) return <AppDetailSample />
  if (!app)
    return (
      <AppDetailFrame name="Not found">
        <h1 className="text-2xl font-medium tracking-tight">App not found</h1>
        <EmptyState>This app does not exist or was removed.</EmptyState>
      </AppDetailFrame>
    )
  return <AppDetail app={app} loading={found.pending || (app.source === "registry" && registry.isPending)} />
}
