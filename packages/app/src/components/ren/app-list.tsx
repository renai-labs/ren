import type { ReactNode } from "react"
import { IconBolt, IconRosetteDiscountCheckFilled, IconUser, IconUsers } from "@tabler/icons-react"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { AppIcon } from "@/components/ren/app-icon"
import { gaps } from "@/lib/apps"
import type { AppProfileInfo } from "@ren/client"
import { useSpaces } from "@/hooks/use-spaces"
import type { CatalogApp } from "@/lib/apps"

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

export function AppGrid(props: { label: string; children: ReactNode }) {
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a grid of Item cards; Item renders a div
      role="list"
      aria-label={props.label}
      className="grid grid-cols-1 gap-3 md:grid-cols-2"
    >
      {props.children}
    </div>
  )
}

export function AppRow(props: {
  name: string
  icon?: string | null
  caption: string
  status?: string | undefined
  attention?: boolean
  onOpen?: () => void
  action?: ReactNode
}) {
  return (
    <Item
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Item renders a div inside the list grid
      role="listitem"
      variant="outline"
      className="relative flex-nowrap gap-3 rounded-xl bg-card p-3 shadow-soft has-[[data-slot=app-open]:hover]:bg-muted/50"
    >
      <ItemMedia className="self-start">
        <AppIcon name={props.name} icon={props.icon} size="lg" />
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <ItemTitle className="max-w-full">
          {props.onOpen ? (
            <button
              type="button"
              data-slot="app-open"
              onClick={props.onOpen}
              className="truncate text-left outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
            >
              {props.name}
            </button>
          ) : (
            <span className="truncate">{props.name}</span>
          )}
          {props.attention ? <AttentionDot /> : null}
        </ItemTitle>
        <ItemDescription className="line-clamp-2 min-h-8 text-xs/4">{props.caption}</ItemDescription>
        {props.status ? <span className="mt-1 truncate text-xs text-muted-foreground">{props.status}</span> : null}
      </ItemContent>
      {props.action ? <ItemActions className="relative">{props.action}</ItemActions> : null}
    </Item>
  )
}

export function AppSheet(props: {
  app: App | undefined
  action?: ReactNode
  children?: ReactNode
  onClose: () => void
}) {
  const app = props.app
  const spaceName = useSpaces().spaceName
  const mcps = app ? Object.entries(app.mcps) : []
  const skills = app ? Object.entries(app.skills) : []
  return (
    <Sheet
      open={app !== undefined}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <SheetContent className="gap-0 data-[side=right]:sm:max-w-3xl">
        {app ? (
          <div className="flex flex-1 flex-col gap-9 overflow-y-auto overscroll-contain px-7 pt-7 pb-10">
            <SheetHeader className="gap-4 p-0">
              <AppIcon name={app.name} icon={app.icon} size="xl" />
              <div className="flex items-center justify-between gap-8">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <SheetTitle className="flex items-center gap-1.5 text-lg/7">
                    {app.name}
                    {app.source === "registry" ? (
                      <IconRosetteDiscountCheckFilled
                        aria-label="From Ren’s registry"
                        className="size-4 text-chart-1"
                      />
                    ) : null}
                  </SheetTitle>
                  <SheetDescription className="leading-5">{app.listing?.body ?? app.description}</SheetDescription>
                </div>
                {props.action ? <div className="flex shrink-0">{props.action}</div> : null}
              </div>
            </SheetHeader>
            {props.children}
            {mcps.length > 0 ? (
              <SheetSection title="MCPs">
                <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                  {mcps.map(([slug, mcp]) => (
                    <Entry
                      key={slug}
                      media={<AppIcon name={app.name} icon={app.icon} size="lg" />}
                      title={slug}
                      description={transportLabel(mcp.transport)}
                    />
                  ))}
                </div>
              </SheetSection>
            ) : null}
            {skills.length > 0 ? (
              <SheetSection title="Skills">
                <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                  {skills.map(([slug, skill]) => (
                    <Entry
                      key={slug}
                      media={<Tile icon={<IconBolt />} />}
                      title={slug}
                      description={skill.type === "content" ? skill.description : skill.upstream.url}
                    />
                  ))}
                </div>
              </SheetSection>
            ) : null}
            <SheetSection title="Metadata">
              <dl className="grid grid-cols-2 gap-y-4 text-sm">
                <dt className="text-muted-foreground">Source</dt>
                <dd>{app.source === "registry" ? "Ren registry" : `Made in ${spaceName(app.ownerSpaceId ?? "")}`}</dd>
                <dt className="text-muted-foreground">Slug</dt>
                <dd className="font-mono">{app.slug}</dd>
                <dt className="text-muted-foreground">Capabilities</dt>
                <dd>
                  {[skills.length ? "Skills" : undefined, mcps.length ? "MCP servers" : undefined]
                    .filter(Boolean)
                    .join(", ")}
                </dd>
              </dl>
            </SheetSection>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

const transportLabel = (transport: App["mcps"][string]["transport"]) => {
  if (transport.type === "remote") return "streamable-http"
  if (transport.type === "local") return "stdio"
  return transport.provider
}

function Tile(props: { icon: ReactNode }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-6 [&_svg]:stroke-[1.5]">
      {props.icon}
    </span>
  )
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

export function AccountList(props: {
  title: string
  actions?: ReactNode
  profiles: ReadonlyArray<AppProfile>
  empty?: string
  caption: (profile: AppProfile) => string
  action: (profile: AppProfile) => ReactNode
}) {
  if (props.profiles.length === 0 && !props.actions) return null
  return (
    <SheetSection title={props.title} actions={props.actions}>
      {props.profiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">{props.empty ?? "No accounts yet"}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {props.profiles.map((profile) => (
            <Entry
              key={profile.id}
              media={<Tile icon={profile.kind === "private" ? <IconUser /> : <IconUsers />} />}
              title={profile.name}
              badge={gaps(profile).length > 0 ? <AttentionDot /> : undefined}
              description={props.caption(profile)}
            >
              {props.action(profile)}
            </Entry>
          ))}
        </div>
      )}
    </SheetSection>
  )
}
