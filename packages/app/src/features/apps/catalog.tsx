import { useNavigate } from "@tanstack/react-router"
import { IconPlus } from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { AppGrid, AppRow, AppRowSample, AppSection } from "../../components/app-list.js"
import { EmptyState } from "../../components/empty-state.js"
import { LoadMore } from "../../components/load-more.js"
import { needsAttention, type CatalogApp } from "../../lib/apps.js"
import { Search } from "../../lib/search.js"
import { useAppProfiles } from "../../lib/use-app-profiles.js"

export function CatalogAppRow(props: { app: CatalogApp; onAdd: (app: CatalogApp) => void }) {
  const navigate = useNavigate()
  const profiles = useAppProfiles([props.app.id]).of(props.app.id)
  return (
    <AppRow
      name={props.app.name}
      icon={props.app.icon}
      caption={props.app.description}
      attention={needsAttention(profiles)}
      onOpen={() => void navigate({ to: "/apps/$appId", params: { appId: props.app.id } })}
      action={
        <Button
          variant="ghost"
          size="icon"
          className="size-10 text-muted-foreground [&_svg:not([class*='size-'])]:size-6"
          aria-label={`Add ${props.app.name} to a space`}
          onClick={() => props.onAdd(props.app)}
        >
          <IconPlus />
        </Button>
      }
    />
  )
}

export function AppGridSample(props: { count: number }) {
  return (
    <AppGrid label="Loading apps">
      {Array.from({ length: props.count }, (_, index) => (
        <AppRowSample key={index} />
      ))}
    </AppGrid>
  )
}

export function CatalogList(props: {
  label: string
  heading?: boolean
  count?: number | undefined
  apps: ReadonlyArray<CatalogApp>
  query: string
  empty: string
  more: boolean
  onMore: () => void
  fetching: boolean
  onAdd: (app: CatalogApp) => void
}) {
  if (props.apps.length === 0 && !props.more) return <EmptyState>{Search.empty(props.query, props.empty)}</EmptyState>
  const rows = props.apps.map((app) => <CatalogAppRow key={app.id} app={app} onAdd={props.onAdd} />)
  return (
    <div className="flex flex-col gap-0.5">
      {props.heading ? (
        <AppSection title={props.label} count={props.count}>
          {rows}
        </AppSection>
      ) : (
        <AppGrid label={props.label}>{rows}</AppGrid>
      )}
      <LoadMore more={props.more} onMore={props.onMore} />
      {props.fetching ? <AppGridSample count={4} /> : null}
    </div>
  )
}
