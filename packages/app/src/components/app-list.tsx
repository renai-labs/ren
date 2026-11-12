import { useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { IconChevronRight, IconPlus, IconRosetteDiscountCheckFilled } from "@tabler/icons-react"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@ren/ui/dialog"
import { Loading } from "@ren/ui/loading"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@ren/ui/item"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@ren/ui/sheet"
import { AppIcon, appTile } from "./app-icon.js"
import { DefaultIcon } from "./default-icon.js"
import { Markdown } from "./markdown.js"
import { ToolbarSearch } from "./toolbar-search.js"
import { categoryLabel, gaps, reachedSpaces } from "../lib/apps.js"
import { plural } from "../lib/format.js"
import { cn } from "cn"
import type { AppListingTool, AppProfileInfo } from "@ren/client"
import { RouterContext } from "../lib/router-context.js"
import { useSpaces } from "../lib/use-spaces.js"
import type { CatalogApp } from "../lib/apps.js"

type App = CatalogApp
type AppProfile = AppProfileInfo

function AttentionDot() {
  return (
    <span
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a colored dot drawn with CSS, announced as an image
      role="img"
      aria-label="Needs attention"
      className="size-1.5 shrink-0 rounded-full bg-chart-3"
    />
  )
}

export function AppSection(props: {
  title: string
  heading?: ReactNode
  count?: number | undefined
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">
        {props.heading ?? props.title}
        {props.count === undefined ? null : <span className="ml-1.5 text-muted-foreground">{props.count}</span>}
      </h2>
      <AppGrid label={props.title}>{props.children}</AppGrid>
    </section>
  )
}

export function AppGrid(props: { label: string; children: ReactNode }) {
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a grid of Item rows; Item renders a div
      role="list"
      aria-label={props.label}
      className="-mx-2 grid grid-cols-1 gap-x-6 gap-y-0.5 md:grid-cols-2"
    >
      {props.children}
    </div>
  )
}

export function AppRowSample() {
  return (
    <AppRow
      name="Team app"
      caption="Tools for your team’s work"
      action={
        <Button
          variant="ghost"
          size="icon"
          className="size-10 [&_svg:not([class*='size-'])]:size-6"
          aria-label="Add app to a space"
        >
          <IconPlus />
        </Button>
      }
    />
  )
}

export function AppListingSample(props: { title?: string | undefined; count?: number | undefined }) {
  return (
    <AppSection title={props.title ?? "All apps"}>
      {Array.from({ length: props.count ?? 6 }, (_, index) => (
        <AppRowSample key={index} />
      ))}
    </AppSection>
  )
}

export function AppRow(props: {
  name: string
  icon?: string | null
  caption: string
  attention?: boolean | undefined
  compact?: boolean | undefined
  onOpen?: () => void
  action?: ReactNode
}) {
  return (
    <Item
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Item renders a div inside the list grid
      role="listitem"
      className={cn(
        "relative flex-nowrap gap-3 has-[[data-slot=app-open]:hover]:bg-muted",
        props.compact ? "px-2 py-2.5" : "p-2",
      )}
    >
      <ItemMedia>
        {props.compact ? (
          <AppIcon name={props.name} description={props.caption} icon={props.icon} className="size-9 rounded-lg" />
        ) : (
          <AppIcon name={props.name} description={props.caption} icon={props.icon} size="lg" />
        )}
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className={cn("max-w-full", props.compact ? "font-medium" : "font-normal")}>
          {props.onOpen ? (
            <Button
              variant="ghost"
              data-slot="app-open"
              onClick={props.onOpen}
              className="block h-auto min-w-0 justify-start truncate rounded-none border-0 p-0 text-left font-[inherit] after:absolute after:inset-0 after:rounded-lg hover:bg-transparent focus-visible:ring-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50 active:not-aria-[haspopup]:scale-none"
            >
              {props.name}
            </Button>
          ) : (
            <span className="truncate">{props.name}</span>
          )}
          {props.attention ? <AttentionDot /> : null}
        </ItemTitle>
        <ItemDescription className={cn("line-clamp-1", props.compact && "text-xs")}>{props.caption}</ItemDescription>
      </ItemContent>
      {props.action ? (
        <ItemActions className="pointer-events-none relative [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
          {props.action}
        </ItemActions>
      ) : null}
    </Item>
  )
}

function AppDetails(props: { app: App; action?: ReactNode; children?: ReactNode }) {
  const app = props.app
  return (
    <div className="flex flex-1 flex-col gap-9 overflow-y-auto overscroll-contain px-7 pt-7 pb-10">
      <SheetHeader className="gap-4 p-0">
        <AppIcon name={app.name} description={app.description} icon={app.icon} size="xl" />
        <div className="flex items-center justify-between gap-8">
          <div className="flex min-w-0 flex-col gap-1.5">
            <SheetTitle className="flex items-center gap-1.5 text-lg/7">
              {app.name}
              {app.source === "registry" ? (
                <IconRosetteDiscountCheckFilled aria-label="From Ren’s registry" className="size-4 text-chart-1" />
              ) : null}
            </SheetTitle>
            <SheetDescription className="leading-5">{app.listing?.body ?? app.description}</SheetDescription>
          </div>
          {props.action ? <div className="flex shrink-0">{props.action}</div> : null}
        </div>
      </SheetHeader>
      {props.children}
      <AppSections app={app} />
    </div>
  )
}

function McpCards(props: { app: App; mcps: NonNullable<App["mcps"]> }) {
  const app = props.app
  const tile = appTile(app)
  const [opened, setOpened] = useState<string>()
  const openedMcp = opened === undefined ? undefined : props.mcps[opened]
  const mcpIcon = (slug: string) =>
    tile ? (
      <DefaultIcon kind="mcp" name={slug} tile={tile} />
    ) : (
      <AppIcon name={app.name} description={app.description} icon={app.icon} size="lg" />
    )
  return (
    <SheetSection title="MCPs">
      <div className="-mx-2 grid grid-cols-2 gap-x-4 gap-y-1">
        {Object.entries(props.mcps).map(([slug, mcp]) => {
          const tools = app.listing?.toolCounts[slug] ?? 0
          return (
            <Button
              key={slug}
              variant="ghost"
              aria-haspopup="dialog"
              onClick={() => setOpened(slug)}
              className="h-auto min-w-0 justify-start gap-3 rounded-lg p-2 text-left font-normal active:not-aria-[haspopup]:scale-none"
            >
              {mcpIcon(slug)}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{slug}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {tools > 0 ? plural(tools, "tool") : transportLabel(mcp.transport)}
                </span>
              </span>
            </Button>
          )
        })}
      </div>
      {opened && openedMcp ? (
        <McpDialog
          appId={app.id}
          slug={opened}
          mcp={openedMcp}
          count={app.listing?.toolCounts[opened] ?? 0}
          icon={mcpIcon(opened)}
          onClose={() => setOpened(undefined)}
        />
      ) : null}
    </SheetSection>
  )
}

export function AppSections(props: { app: App }) {
  const app = props.app
  const spaceName = useSpaces().spaceName
  const skills = Object.entries(app.skills ?? {})
  const tile = appTile(app)
  const categories = [...new Set(Object.values(app.listing?.categories ?? {}).flat())].map(categoryLabel)
  const facts = [
    ...(categories.length > 0 ? [["Category", categories.join(", ")] as const] : []),
    ["Source", app.source === "registry" ? "Ren registry" : `Made in ${spaceName(app.ownerSpaceId ?? "")}`],
  ] as const
  return (
    <>
      {app.mcps && Object.keys(app.mcps).length > 0 ? <McpCards app={app} mcps={app.mcps} /> : null}
      {skills.length > 0 ? (
        <SheetSection title="Skills">
          <div className="grid grid-cols-2 gap-x-8 gap-y-5">
            {skills.map(([slug, skill]) => (
              <Entry
                key={slug}
                media={
                  <DefaultIcon
                    kind="skill"
                    name={slug}
                    description={skill.type === "content" ? skill.description : undefined}
                    tile={tile}
                  />
                }
                title={slug}
                description={skill.type === "content" ? skill.description : skill.upstream.url}
              />
            ))}
          </div>
        </SheetSection>
      ) : null}
      <SheetSection title="Information">
        <dl className="divide-y rounded-xl border text-sm">
          {facts.map(([term, value]) => (
            <div key={term} className="grid grid-cols-[--spacing(40)_1fr] gap-4 px-4 py-3">
              <dt className="text-muted-foreground">{term}</dt>
              <dd className="min-w-0 truncate">{value}</dd>
            </div>
          ))}
        </dl>
      </SheetSection>
    </>
  )
}

export function AppSheet(props: {
  app: App | undefined
  action?: ReactNode
  children?: ReactNode
  onClose: () => void
}) {
  const app = props.app
  return (
    <Sheet
      open={app !== undefined}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <SheetContent className="gap-0 data-[side=right]:sm:max-w-3xl">
        {app ? (
          <AppDetails app={app} action={props.action}>
            {props.children}
          </AppDetails>
        ) : (
          <SheetTitle className="sr-only">App</SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  )
}

type Mcp = NonNullable<App["mcps"]>[string]

const transportLabel = (transport: Mcp["transport"]) => {
  if (transport.type === "remote") return "streamable-http"
  if (transport.type === "local") return "stdio"
  if (transport.type === "managed") return "managed by Ren"
  return transport.provider
}

function Entry(props: {
  media: ReactNode
  title: string
  badge?: ReactNode
  description?: string
  children?: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {props.media}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <span className="truncate">{props.title}</span>
          {props.badge}
        </span>
        {props.description ? <span className="truncate text-xs text-muted-foreground">{props.description}</span> : null}
      </div>
      {props.children ? <div className="flex shrink-0 items-center gap-1">{props.children}</div> : null}
    </div>
  )
}

function SheetSection(props: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex min-h-6.5 items-center justify-between gap-2">
        <h3 className="text-base font-medium">{props.title}</h3>
        {props.actions}
      </div>
      {props.children}
    </section>
  )
}

function ToolGroup(props: { title: string; tools: ReadonlyArray<AppListingTool> }) {
  return (
    <Collapsible defaultOpen render={<section aria-label={`${props.title} tools`} />}>
      <div className="sticky top-0 z-10 bg-background pt-3">
        <CollapsibleTrigger
          render={<Button variant="ghost" className="group/group w-full justify-between px-2 font-medium" />}
        >
          <span className="flex items-baseline gap-1.5">
            {props.title}
            <span className="font-normal text-muted-foreground tabular-nums">{props.tools.length}</span>
          </span>
          <IconChevronRight
            data-icon="inline-end"
            className="text-muted-foreground transition-transform duration-150 ease-out group-aria-expanded/group:rotate-90"
          />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <ul className="divide-y px-2 pb-2">
          {props.tools.map((tool) => (
            <li key={tool.name} className="flex flex-col gap-1 py-3">
              <span className="font-mono text-sm break-all">{tool.name}</span>
              {tool.description ? (
                <Markdown className="text-sm/6 text-muted-foreground">{tool.description}</Markdown>
              ) : null}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

function McpDialog(props: {
  appId: string
  slug: string
  mcp: Mcp
  count: number
  icon: ReactNode
  onClose: () => void
}) {
  const { api } = RouterContext.useRouterContext()
  const [query, setQuery] = useState("")
  const listed = useQuery({
    ...api["app-tools"].get.queryOptions({ idOrSlug: props.appId }),
    enabled: props.count > 0,
  })
  const pending = props.count > 0 && listed.isPending
  const tools = listed.data?.[props.slug] ?? []
  const needle = query.trim().toLowerCase()
  const shown = tools.filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(needle))
  const groups = [
    { title: "Read", tools: shown.filter((tool) => tool.readOnly) },
    { title: "Write", tools: shown.filter((tool) => !tool.readOnly) },
  ].filter((group) => group.tools.length > 0)
  const empty = (() => {
    if (listed.isError) return "Couldn’t load this MCP’s tools. Close and open it to try again."
    if (props.count === 0) return "The registry doesn’t list this MCP’s tools yet."
    return `No tools match “${query.trim()}”`
  })()
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="flex-row items-center justify-between gap-4 border-b py-4 pr-14 pl-6">
          <div className="flex min-w-0 items-center gap-3">
            {props.icon}
            <DialogTitle className="flex min-w-0 items-baseline gap-2">
              <span className="truncate">{props.mcp.name}</span>
              <span className="text-sm font-normal text-muted-foreground">MCP</span>
            </DialogTitle>
          </div>
          {props.count > 0 ? (
            <ToolbarSearch label={`Search ${plural(props.count, "tool")}`} value={query} onChange={setQuery} />
          ) : null}
        </DialogHeader>
        <div className="flex flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-3">
          <Loading loading={pending} label="Loading tools">
            {pending ? (
              <ToolGroup
                title="Read"
                tools={Array.from({ length: Math.min(props.count, 6) }, (_, index) => ({
                  name: `tool_${index}`,
                  description: "What this tool does",
                  readOnly: true,
                }))}
              />
            ) : null}
            {!pending && groups.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{empty}</p>
            ) : null}
            {pending
              ? null
              : groups.map((group) => <ToolGroup key={group.title} title={group.title} tools={group.tools} />)}
          </Loading>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function SpacePills(props: { profile: AppProfile }) {
  const names = reachedSpaces(props.profile)
  if (names.length === 0) return <span>Not in any space</span>
  return names.map((name) => (
    <Badge key={name} variant="secondary" className="rounded-full px-2 font-normal">
      {name}
    </Badge>
  ))
}

export function AccountList(props: {
  title: string
  actions?: ReactNode
  profiles: ReadonlyArray<AppProfile>
  empty?: string
  caption?: (profile: AppProfile) => string
  aside?: (profile: AppProfile) => ReactNode
  action: (profile: AppProfile) => ReactNode
  onOpen?: ((profile: AppProfile) => void) | undefined
}) {
  if (props.profiles.length === 0 && !props.actions) return null
  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-6.5 items-center justify-between gap-2">
        <h3 className="text-base font-medium">
          {props.title}
          {props.profiles.length > 0 ? (
            <span className="ml-1.5 text-muted-foreground tabular-nums">{props.profiles.length}</span>
          ) : null}
        </h3>
        {props.actions}
      </div>
      {props.profiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">{props.empty ?? "No accounts yet"}</p>
      ) : (
        <div className="-mx-3 flex flex-col gap-1">
          {props.profiles.map((profile) => {
            const missing = gaps(profile).length > 0
            const open = props.onOpen
            return (
              <div
                key={profile.id}
                className="group/row relative flex min-h-14 items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 ease-out has-[[data-slot=account-open]:hover]:bg-muted"
              >
                <span
                  aria-hidden
                  className={cn("size-2 shrink-0 rounded-full", missing ? "bg-chart-3" : "bg-chart-2")}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  {open ? (
                    <Button
                      variant="ghost"
                      data-slot="account-open"
                      onClick={() => open(profile)}
                      className="block h-auto min-w-0 justify-start truncate rounded-none border-0 p-0 text-left font-normal after:absolute after:inset-0 after:rounded-lg hover:bg-transparent focus-visible:ring-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50 active:not-aria-[haspopup]:scale-none"
                    >
                      {profile.name}
                    </Button>
                  ) : (
                    <span className="truncate text-sm">{profile.name}</span>
                  )}
                  {missing || props.caption ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {[missing ? "Not connected" : undefined, props.caption?.(profile)]
                        .filter((part) => part !== undefined)
                        .join(" · ")}
                    </span>
                  ) : null}
                </div>
                {props.aside ? (
                  <div className="flex max-w-1/2 flex-wrap justify-end gap-1">{props.aside(profile)}</div>
                ) : null}
                <div
                  className={cn(
                    "relative flex shrink-0 items-center gap-1",
                    open &&
                      "transition-opacity duration-150 ease-out group-focus-within/row:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100",
                  )}
                >
                  {props.action(profile)}
                </div>
                {open && !missing ? (
                  <IconChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-hover/row:translate-x-0.5" />
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
