import type { AppProfileInfo } from "@ren/client"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Document } from "@ren/ui/document"
import { Icon } from "@ren/ui/icon"
import type { Glyph } from "@ren/ui/icon"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@ren/ui/item"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@ren/ui/sheet"
import { StatusDot } from "@ren/ui/status-dot"
import { Initials } from "@ren/util/initials"
import type { ReactNode } from "react"
import { Profiles } from "../../components/profiles.js"
import type { Apps } from "../../components/apps.js"

// oxlint-disable-next-line ren/no-comments -- ren-v1 app drawer: the app, its accounts, then what it brings. The Marketplace and a space give their own action and accounts.
export function AppDrawer(props: {
  app: Apps.Entry | undefined
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
      <SheetContent className="gap-0">
        {app ? (
          <div className="flex flex-1 flex-col gap-8 overflow-y-auto overscroll-contain p-6">
            <SheetHeader className="p-0">
              <div className="flex items-start gap-4 pr-8">
                <Avatar size="lg" aria-hidden className="size-12 rounded-lg after:rounded-lg">
                  <AvatarImage src={app.icon} alt="" className="m-auto size-3/4 rounded-none object-contain" />
                  <AvatarFallback className="rounded-lg">{Initials.of(app.name)}</AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <SheetTitle>{app.name}</SheetTitle>
                  <SheetDescription>{app.description}</SheetDescription>
                </div>
                {props.action}
              </div>
            </SheetHeader>
            {props.children}
            <Parts title="MCP servers" glyph="Server" parts={app.mcps} />
            <Parts title="Skills" glyph="Skill" parts={app.skills} />
            <About text={app.about} />
            <Parts
              title="Try asking"
              glyph="MessageSquare"
              parts={app.prompts.map((prompt) => ({ slug: prompt, description: "" }))}
            />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function Section(props: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h3 className="truncate text-xs font-medium text-muted-foreground uppercase">{props.title}</h3>
        {props.actions ? <div className="flex shrink-0 items-center gap-1">{props.actions}</div> : null}
      </div>
      {props.children}
    </section>
  )
}

export function AccountList(props: {
  title: string
  actions?: ReactNode
  profiles: ReadonlyArray<AppProfileInfo>
  caption: (profile: AppProfileInfo) => string
  action: (profile: AppProfileInfo) => ReactNode
}) {
  if (props.profiles.length === 0 && !props.actions) return null
  return (
    <Section title={props.title} actions={props.actions}>
      <ItemGroup aria-label={props.title} className="gap-1">
        {props.profiles.map((profile) => (
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Item renders a div in the ItemGroup list
          <Item key={profile.id} role="listitem" className="px-0 py-2">
            <ItemMedia variant="icon" className="size-8 rounded-lg bg-muted text-muted-foreground">
              <Icon glyph={profile.kind === "private" ? "User" : "Users"} />
            </ItemMedia>
            <ItemContent className="min-w-0 gap-0.5">
              <ItemTitle className="max-w-full">
                <span className="truncate">{profile.name}</span>
                {Profiles.gaps(profile).length > 0 ? <StatusDot tone="warning" label="Needs attention" /> : null}
              </ItemTitle>
              <ItemDescription className="line-clamp-1 text-xs">{props.caption(profile)}</ItemDescription>
            </ItemContent>
            <ItemActions>{props.action(profile)}</ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </Section>
  )
}

function About(props: { text: string | null }) {
  if (!props.text) return null
  return (
    <Section title="About">
      <Document.Markdown content={props.text} tone="secondary" />
    </Section>
  )
}

function Parts(props: {
  title: string
  glyph: Glyph
  parts: ReadonlyArray<{ readonly slug: string; readonly description: string }>
}) {
  if (props.parts.length === 0) return null
  return (
    <Section title={props.title}>
      <ItemGroup aria-label={props.title} className="gap-1">
        {props.parts.map((part) => (
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Item renders a div in the ItemGroup list
          <Item key={part.slug} role="listitem" className="px-0 py-2">
            <ItemMedia variant="icon" className="size-8 rounded-lg bg-muted text-muted-foreground">
              <Icon glyph={props.glyph} />
            </ItemMedia>
            <ItemContent className="min-w-0 gap-0.5">
              <ItemTitle className="max-w-full">
                <span className="truncate">{part.slug}</span>
              </ItemTitle>
              {part.description ? (
                <ItemDescription className="line-clamp-2 text-xs">{part.description}</ItemDescription>
              ) : null}
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
    </Section>
  )
}
