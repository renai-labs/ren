import type { ReactNode } from "react"
import { IconChevronDown, IconPlus } from "@tabler/icons-react"
import { Link } from "@tanstack/react-router"
import { Breadcrumb } from "./breadcrumb.js"
import { Button } from "@ren/ui/button"
import { Loading } from "@ren/ui/loading"
import { cn } from "cn"
import { AppIcon } from "./app-icon.js"
import { AccountList, AppSections } from "./app-list.js"
import { pageWidths, useShapeId } from "./page.js"
import type { CatalogApp } from "../lib/apps.js"

export function AppDetailFrame(props: { name: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <Breadcrumb.Header>
        <Breadcrumb.Root ancestors={[{ key: "apps", content: <Link to="/apps">Apps</Link> }]}>
          {props.name}
        </Breadcrumb.Root>
      </Breadcrumb.Header>
      <div className={cn("mx-auto flex w-full flex-1 flex-col gap-10 px-6 pt-8 pb-12", pageWidths.column)}>
        {props.children}
      </div>
    </div>
  )
}

export function AppHeader(props: { name: string; description: string; icon: string | null; actions: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-6 max-sm:flex-col max-sm:items-start">
      <div className="flex min-w-0 items-center gap-4">
        <AppIcon
          name={props.name}
          description={props.description}
          icon={props.icon}
          className="size-16 rounded-2xl shadow-sm ring-1 ring-border"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-medium tracking-tight">{props.name}</h1>
          <p className="text-sm/6 text-muted-foreground">{props.description}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">{props.actions}</div>
    </header>
  )
}

const sampleMcp = {
  name: "Server",
  description: "Tools for this app",
  transport: { type: "remote", url: "https://example.com/mcp" },
  auth: { type: "none" },
} as const

const sampleApp: CatalogApp = {
  id: "app",
  slug: "app",
  name: "App",
  description: "Tools for your team’s work",
  icon: null,
  brandColor: null,
  source: "registry",
  ownerSpaceId: null,
  mcps: { server: sampleMcp, tools: sampleMcp },
  skills: {},
  dependsOn: [],
  listing: null,
}

export function AppDetailsSample() {
  return (
    <div className="flex flex-col gap-10">
      <div className="min-h-64 rounded-2xl bg-muted sm:min-h-80" />
      <p className="text-sm/6 text-muted-foreground">What this app does and how to set it up.</p>
      <AccountList
        title="Accounts"
        app={sampleApp}
        actions={
          <Button size="sm">
            <IconPlus data-icon="inline-start" />
            New account
          </Button>
        }
        profiles={[]}
        onOpen={() => undefined}
      />
      <AppSections app={sampleApp} />
    </div>
  )
}

export function AppDetailSample() {
  const headerShape = useShapeId("app-header")
  const detailsShape = useShapeId("app-details")
  return (
    <AppDetailFrame name="App">
      <Loading id={headerShape} loading label="Loading app">
        <AppHeader
          name="App name"
          description="Tools for your team’s work"
          icon={null}
          actions={
            <Button>
              Add to space
              <IconChevronDown />
            </Button>
          }
        />
      </Loading>
      <Loading id={detailsShape} loading label="Loading app details">
        <AppDetailsSample />
      </Loading>
    </AppDetailFrame>
  )
}
