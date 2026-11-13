import { createContext, use, useDeferredValue, useState, type ReactNode } from "react"
import type { ArtifactInfo } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  IconArchive,
  IconAdjustmentsHorizontal,
  IconBrowser,
  IconChevronDown,
  IconCube,
  IconExternalLink,
  IconLayoutGridFilled,
  IconLink,
  IconLinkOff,
  IconList,
  IconLock,
  IconPlus,
  IconPencil,
  IconSparkles,
} from "@tabler/icons-react"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@ren/ui/empty"
import { Loading } from "@ren/ui/loading"
import { toast } from "@ren/ui/sonner"
import { Spinner } from "@ren/ui/spinner"
import { formatRelative } from "@ren/ui/time"
import { Popover, PopoverContent, PopoverTrigger } from "@ren/ui/popover"
import { Tabs, TabsList, TabsTrigger } from "@ren/ui/tabs"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { cn } from "cn"
import { Artifacts } from "../lib/artifacts.js"
import { errorMessage } from "../lib/errors.js"
import { Loader } from "../lib/loader.js"
import { RouterContext } from "../lib/router-context.js"
import { useNow } from "../lib/use-now.js"
import { useSpaces } from "../lib/use-spaces.js"
import { Platform } from "../platform/platform.js"
import { ArtifactPreview } from "./artifact-preview.js"
import { FilterChips, FilterMenu, type FilterProperty, type Filters } from "./filter-menu.js"
import { MenuSearch } from "./menu-search.js"
import { useShapeId } from "./page.js"
import { RowMenu } from "./row-menu.js"
import { ToolbarSearch } from "./toolbar-search.js"

type Group = {
  readonly spaceId: string
  readonly name: string
  readonly kind: string | undefined
  readonly artifacts: ReadonlyArray<ArtifactInfo>
}

type Context = {
  readonly state: {
    readonly all: ReadonlyArray<ArtifactInfo> | undefined
    readonly visible: ReadonlyArray<ArtifactInfo>
    readonly groups: ReadonlyArray<Group>
    readonly view: Artifacts.View
    readonly sort: Artifacts.Sort
    readonly collapsed: ReadonlyArray<string>
    readonly filters: Filters
    readonly query: string
    readonly filtered: boolean
    readonly spaceId: string | undefined
    readonly now: number
  }
  readonly actions: {
    readonly setQuery: (query: string) => void
    readonly setView: (view: Artifacts.View) => void
    readonly setSort: (sort: Artifacts.Sort) => void
    readonly setOpen: (spaceId: string, options: { open: boolean }) => void
    readonly setFilters: (filters: Filters) => void
    readonly clear: () => void
    readonly build: (spaceId: string) => void
    readonly edit: (artifact: ArtifactInfo) => void
    readonly open: (url: string) => void
    readonly copy: ((url: string) => void) | undefined
    readonly archive: (artifact: ArtifactInfo) => Promise<unknown>
  }
  readonly meta: {
    readonly spaceOptions: FilterProperty["options"]
    readonly joined: ReadonlyArray<{ readonly id: string; readonly name: string; readonly kind: string }>
  }
}

const ArtifactsContext = createContext<Context | null>(null)

function useArtifacts() {
  const value = use(ArtifactsContext)
  if (value === null) throw new Error("useArtifacts must be used inside ArtifactGallery.Root")
  return value
}

const byUpdated = (a: ArtifactInfo, b: ArtifactInfo) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)

const byTitle = (a: ArtifactInfo, b: ArtifactInfo) => a.title.localeCompare(b.title) || byUpdated(a, b)

const samples: ReadonlyArray<ArtifactInfo> = Array.from({ length: 6 }, (_, index) => ({
  id: `art_sample${index}`,
  spaceId: "sample",
  title: "Artifact title",
  entry: "index.html",
  url: "https://artifact.example",
  pendingDeploymentId: null,
  publishedDeploymentId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
}))

function Root(props: {
  spaceId?: string | undefined
  search: Artifacts.Search
  onSearch: (update: Partial<Artifacts.Search>, navigation?: { readonly replace?: boolean }) => void
  children: ReactNode
}) {
  const { client, api } = RouterContext.useRouterContext()
  const platform = Platform.usePlatform()
  const navigate = useNavigate()
  const spaces = useSpaces()
  const now = useNow()
  const artifacts = useQuery({ ...Artifacts.allOptions(client, props.spaceId), ...Loader.required })
  const archive = useMutation(api.artifact.archive.mutationOptions())
  const query = props.search.q ?? ""
  const needle = useDeferredValue(query).trim().toLowerCase()
  const sort = props.search.sort ?? "updated"
  const collapsed = props.search.collapsed ?? []
  const filters: Filters =
    props.spaceId === undefined
      ? Object.fromEntries(Object.entries(props.search.filters ?? {}).map((entry) => [entry[0], [...entry[1]]]))
      : {}
  const chosen = filters.space ?? []
  const all = artifacts.data
  const visible = (all ?? [])
    .filter((artifact) => chosen.length === 0 || chosen.includes(artifact.spaceId))
    .filter(
      (artifact) =>
        !needle ||
        [artifact.title, artifact.entry, Artifacts.host(artifact.url) ?? "", spaces.spaceName(artifact.spaceId)]
          .join(" ")
          .toLowerCase()
          .includes(needle),
    )
    .toSorted({ name: byTitle, updated: byUpdated }[sort])
  const groups = [...Map.groupBy(visible, (artifact) => artifact.spaceId)]
    .map((entry) => ({
      spaceId: entry[0],
      name: spaces.spaceName(entry[0]),
      kind: spaces.space(entry[0])?.kind,
      artifacts: entry[1],
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name) || a.spaceId.localeCompare(b.spaceId))
  const counts = Map.groupBy(all ?? [], (artifact) => artifact.spaceId)
  const write = platform.writeClipboardText
  const value: Context = {
    state: {
      all,
      visible,
      groups,
      view: props.search.view ?? "gallery",
      sort,
      collapsed,
      filters,
      query,
      filtered: needle !== "" || chosen.length > 0,
      spaceId: props.spaceId,
      now,
    },
    actions: {
      setQuery: (text) => {
        props.onSearch({ q: text || undefined }, { replace: true })
      },
      setView: (view) => props.onSearch({ view: view === "gallery" ? undefined : view }),
      setSort: (next) => props.onSearch({ sort: next === "updated" ? undefined : next }),
      setOpen: (spaceId, options) => {
        const next = options.open ? collapsed.filter((id) => id !== spaceId) : [...collapsed, spaceId]
        props.onSearch({ collapsed: next.length > 0 ? next : undefined }, { replace: true })
      },
      setFilters: (next) =>
        props.onSearch({ filters: Object.values(next).some((values) => values.length > 0) ? next : undefined }),
      clear: () => {
        props.onSearch({ q: undefined, filters: undefined })
      },
      build: (spaceId) => void navigate({ to: "/", search: { spaceId, prompt: "Build an artifact: " } }),
      edit: (artifact) =>
        void navigate({
          to: "/",
          search: {
            spaceId: artifact.spaceId,
            artifact: artifact.id,
            artifactName: artifact.title,
            prompt: `Edit @${artifact.title}`,
          },
        }),
      open: (url) => platform.openExternal(url),
      copy: write
        ? (url) =>
            void write(url).then(
              () => toast.success("Link copied", { description: url }),
              (error: unknown) => toast.error("Could not copy the link", { description: errorMessage(error) }),
            )
        : undefined,
      archive: (artifact) =>
        archive.mutateAsync({ id: artifact.id }).then(
          () => toast.success(`“${artifact.title}” archived`),
          (error: unknown) => toast.error("Could not archive the artifact", { description: errorMessage(error) }),
        ),
    },
    meta: {
      spaceOptions: spaces.spaces
        .filter((space) => counts.has(space.id) || chosen.includes(space.id))
        .map((space) => ({
          value: space.id,
          label: space.name,
          icon: space.kind === "private" ? IconLock : IconCube,
          count: counts.get(space.id)?.length ?? 0,
        })),
      joined: spaces.joined,
    },
  }
  return <ArtifactsContext value={value}>{props.children}</ArtifactsContext>
}

function Search() {
  const context = useArtifacts()
  return <ToolbarSearch label="Search artifacts" value={context.state.query} onChange={context.actions.setQuery} />
}

function Build() {
  const context = useArtifacts()
  const [query, setQuery] = useState("")
  const spaceId = context.state.spaceId
  if (spaceId !== undefined)
    return (
      <Button onClick={() => context.actions.build(spaceId)}>
        <IconSparkles data-icon="inline-start" />
        Build with Ren
      </Button>
    )
  const needle = query.trim().toLowerCase()
  const joined = context.meta.joined.filter((space) => space.name.toLowerCase().includes(needle))
  return (
    <DropdownMenu onOpenChange={(open) => (open ? undefined : setQuery(""))}>
      <DropdownMenuTrigger render={<Button />}>
        <IconSparkles data-icon="inline-start" />
        Build with Ren
        <IconChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {context.meta.joined.length > 6 ? (
          <MenuSearch value={query} onChange={setQuery} placeholder="Find a space" />
        ) : null}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Start a chat in</DropdownMenuLabel>
          {joined.length === 0 ? <div className="px-2 py-1.5 text-sm text-muted-foreground">No spaces</div> : null}
          {joined.map((space) => (
            <DropdownMenuItem key={space.id} onClick={() => context.actions.build(space.id)}>
              {space.kind === "private" ? <IconLock /> : <IconCube />}
              <span className="truncate">{space.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Controls() {
  const context = useArtifacts()
  const state = context.state
  const properties: FilterProperty[] = [
    { key: "space", label: "Space", any: "All spaces", icon: IconCube, options: context.meta.spaceOptions },
  ]
  return state.spaceId === undefined ? (
    <FilterChips properties={properties} value={state.filters} onChange={context.actions.setFilters} />
  ) : null
}

function Filter() {
  const context = useArtifacts()
  if (context.state.spaceId !== undefined) return null
  return (
    <FilterMenu
      label="Filter artifacts"
      properties={[
        { key: "space", label: "Space", any: "All spaces", icon: IconCube, options: context.meta.spaceOptions },
      ]}
      value={context.state.filters}
      onChange={context.actions.setFilters}
      noun="artifact"
    />
  )
}

function Display() {
  const context = useArtifacts()
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" className="text-muted-foreground" aria-label="Display options" />}
      >
        <IconAdjustmentsHorizontal />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 bg-sidebar p-0">
        <Tabs
          value={context.state.view}
          onValueChange={(view: string) => {
            if (Artifacts.isView(view)) context.actions.setView(view)
          }}
          className="p-3"
        >
          <TabsList className="h-9 w-full gap-1">
            <TabsTrigger value="gallery" className="h-7 gap-1.5 border-0 dark:data-active:bg-secondary">
              <IconLayoutGridFilled />
              Gallery
            </TabsTrigger>
            <TabsTrigger value="list" className="h-7 gap-1.5 border-0 dark:data-active:bg-secondary">
              <IconList />
              List
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex h-12 items-center justify-between border-t px-3 text-sm">
          <span className="text-muted-foreground">Order by</span>
          <Select
            items={Object.entries(Artifacts.sortLabels).map(([value, label]) => ({ value, label }))}
            value={context.state.sort}
            onValueChange={(value) => {
              if (Artifacts.isSort(value)) context.actions.setSort(value)
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label="Order by"
              className="h-7 w-40 border-transparent bg-muted hover:bg-secondary dark:bg-muted dark:hover:bg-secondary"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {Object.entries(Artifacts.sortLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ArtifactMenu(props: { artifact: ArtifactInfo; className?: string | undefined }) {
  const context = useArtifacts()
  const artifact = props.artifact
  const url = artifact.url
  const copy = context.actions.copy
  return (
    <RowMenu
      label={`${artifact.title} actions`}
      className={props.className}
      items={[
        { label: "Edit", icon: IconPencil, onSelect: () => context.actions.edit(artifact) },
        ...(url === null
          ? []
          : [
              { label: "Open", icon: IconExternalLink, onSelect: () => context.actions.open(url) },
              ...(copy ? [{ label: "Copy link", icon: IconLink, onSelect: () => copy(url) }] : []),
            ]),
        {
          label: "Archive",
          icon: IconArchive,
          onSelect: () => context.actions.archive(artifact),
          confirm: {
            title: `Archive “${artifact.title}”?`,
            description:
              "Its link stops working for everyone who has it, and it leaves Artifacts. Ren keeps its source and data.",
            action: "Archive",
          },
        },
      ]}
    />
  )
}

function ServingBadge(props: { artifact: ArtifactInfo }) {
  if (props.artifact.pendingDeploymentId !== null)
    return (
      <Badge variant="secondary" className="h-6">
        <Spinner data-icon="inline-start" />
        Updating
      </Badge>
    )
  if (props.artifact.url === null)
    return (
      <Badge variant="secondary" className="h-6">
        <IconLinkOff data-icon="inline-start" />
        Not served
      </Badge>
    )
  return null
}

function OpenTitle(props: { artifact: ArtifactInfo; className?: string | undefined }) {
  const context = useArtifacts()
  const url = props.artifact.url
  const title = props.artifact.title
  if (url === null)
    return (
      <span title={title} className={cn("min-w-0 truncate text-sm font-medium", props.className)}>
        {title}
      </span>
    )
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            onClick={() => context.actions.open(url)}
            className={cn(
              "block h-auto min-w-0 justify-start truncate rounded-none border-0 p-0 text-left text-sm font-medium after:absolute after:inset-0 after:rounded-xl hover:bg-transparent focus-visible:ring-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50 active:not-aria-[haspopup]:scale-none",
              props.className,
            )}
          />
        }
      >
        {title}
      </TooltipTrigger>
      <TooltipContent>Open {title} in a new tab</TooltipContent>
    </Tooltip>
  )
}

function Card(props: { artifact: ArtifactInfo }) {
  const context = useArtifacts()
  const artifact = props.artifact
  return (
    <article className="group/artifact relative flex min-w-0 flex-col gap-2.5">
      <div className="relative">
        <ArtifactPreview
          artifact={artifact}
          size="card"
          className="rounded-xl border transition-colors duration-150 ease-out group-hover/artifact:border-foreground/20"
        />
        <div className="absolute top-2 left-2 flex">
          <ServingBadge artifact={artifact} />
        </div>
      </div>
      <div className="flex min-h-7 items-center gap-2 pl-0.5">
        <OpenTitle artifact={artifact} className="flex-1" />
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatRelative(artifact.updatedAt, context.state.now)}
        </span>
        <ArtifactMenu artifact={artifact} className="relative z-10 flex text-muted-foreground" />
      </div>
    </article>
  )
}

function GalleryGrid(props: { artifacts: ReadonlyArray<ArtifactInfo> }) {
  return (
    <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {props.artifacts.map((artifact) => (
        <Card key={artifact.id} artifact={artifact} />
      ))}
    </div>
  )
}

function ListName(props: { artifact: ArtifactInfo }) {
  const artifact = props.artifact
  return (
    <span className="flex min-w-0 items-center gap-3">
      <ArtifactPreview artifact={artifact} size="thumbnail" className="w-16 shrink-0 rounded-md border" />
      <span className="flex min-w-0 flex-col items-start gap-0.5">
        <OpenTitle artifact={artifact} className="max-w-full after:rounded-lg" />
        <span className="max-w-full truncate text-xs text-muted-foreground">
          {Artifacts.host(artifact.url) ?? "Not served"}
        </span>
      </span>
      {artifact.pendingDeploymentId === null ? null : <ServingBadge artifact={artifact} />}
    </span>
  )
}

function ListTable(props: { artifacts: ReadonlyArray<ArtifactInfo> }) {
  const context = useArtifacts()
  return (
    <ul className="flex flex-col">
      {props.artifacts.map((artifact) => (
        <li key={artifact.id} className="relative flex min-h-20 items-center gap-3 rounded-lg p-3 hover:bg-muted">
          <div className="min-w-0 flex-1">
            <ListName artifact={artifact} />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums sm:w-32">
            {formatRelative(artifact.updatedAt, context.state.now)}
          </span>
          <ArtifactMenu artifact={artifact} className="relative z-10 flex text-muted-foreground" />
        </li>
      ))}
    </ul>
  )
}

function Items(props: { artifacts: ReadonlyArray<ArtifactInfo> }) {
  const context = useArtifacts()
  return context.state.view === "list" ? (
    <ListTable artifacts={props.artifacts} />
  ) : (
    <GalleryGrid artifacts={props.artifacts} />
  )
}

function Groups(props: { groups: ReadonlyArray<Group> }) {
  const context = useArtifacts()
  return (
    <div className="flex flex-col gap-6">
      {props.groups.map((group) => (
        <Collapsible
          key={group.spaceId}
          open={!context.state.collapsed.includes(group.spaceId)}
          onOpenChange={(open) => context.actions.setOpen(group.spaceId, { open })}
          className="flex flex-col gap-4"
        >
          <div className="flex h-9 items-center gap-2 rounded-lg bg-muted pr-2 pl-1 text-sm">
            <CollapsibleTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground aria-expanded:hover:bg-muted aria-expanded:hover:text-foreground [&_svg]:-rotate-90 aria-expanded:[&_svg]:rotate-0"
                  aria-label={`Toggle ${group.name}`}
                />
              }
            >
              <IconChevronDown className="size-3.5" />
            </CollapsibleTrigger>
            {group.kind === "private" ? (
              <IconLock className="size-4 text-muted-foreground" />
            ) : (
              <IconCube className="size-4 text-muted-foreground" />
            )}
            <h2 className="min-w-0 truncate font-medium">
              <Link to="/spaces/$spaceId/artifacts" params={{ spaceId: group.spaceId }}>
                {group.name}
              </Link>
            </h2>
            <span className="text-xs text-muted-foreground tabular-nums">{group.artifacts.length}</span>
            {context.meta.joined.some((space) => space.id === group.spaceId) ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="ml-auto text-muted-foreground"
                      aria-label={`Build with Ren in ${group.name}`}
                      onClick={() => context.actions.build(group.spaceId)}
                    />
                  }
                >
                  <IconPlus className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>Build with Ren in {group.name}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <CollapsibleContent>
            <Items artifacts={group.artifacts} />
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  )
}

function EmptyArtifacts() {
  const context = useArtifacts()
  const state = context.state
  if (state.filtered)
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>No matching artifacts</EmptyTitle>
          <EmptyDescription>
            {state.query.trim() ? `Nothing matches “${state.query.trim()}”` : "Nothing matches these filters"}
            {state.filters.space?.length ? " in the chosen spaces." : "."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={context.actions.clear}>
            Clear search and filters
          </Button>
        </EmptyContent>
      </Empty>
    )
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconBrowser />
        </EmptyMedia>
        <EmptyTitle>No artifacts yet</EmptyTitle>
        <EmptyDescription>
          Sites and apps Ren publishes show up here, each at a link anyone can open. Ask Ren to build one.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Build />
      </EmptyContent>
    </Empty>
  )
}

function Content() {
  const state = useArtifacts().state
  if (state.visible.length === 0) return <EmptyArtifacts />
  if (state.spaceId === undefined) return <Groups groups={state.groups} />
  return <Items artifacts={state.visible} />
}

function Sample() {
  const state = useArtifacts().state
  if (state.spaceId === undefined)
    return <Groups groups={[{ spaceId: "sample", name: "Space", kind: undefined, artifacts: samples }]} />
  return <Items artifacts={samples} />
}

function Body() {
  const state = useArtifacts().state
  const shapeId = useShapeId(`artifacts-${state.view}`)
  const pending = state.all === undefined
  return (
    <Loading id={shapeId} loading={pending} label="Loading artifacts">
      {pending ? <Sample /> : <Content />}
    </Loading>
  )
}

export const ArtifactGallery = { Root, Search, Filter, Display, Build, Controls, Body }
