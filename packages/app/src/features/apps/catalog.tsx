import { useNavigate } from "@tanstack/react-router"
import { AddToSpace, type Added } from "../../components/add-to-space.js"
import { AppGrid, AppRow, AppRowSample, AppSection } from "../../components/app-list.js"
import { EmptyState } from "../../components/empty-state.js"
import { LoadMore } from "../../components/load-more.js"
import { needsAttention, type CatalogApp } from "../../lib/apps.js"
import { Search } from "../../lib/search.js"
import { useAppProfiles } from "../../lib/use-app-profiles.js"

export function CatalogAppRow(props: { app: CatalogApp; onAdded: Added }) {
  const navigate = useNavigate()
  const profiles = useAppProfiles([props.app.id]).of(props.app.id)
  return (
    <AppRow
      name={props.app.name}
      icon={props.app.icon}
      caption={props.app.description}
      attention={needsAttention(profiles)}
      onOpen={() => void navigate({ to: "/apps/$appId", params: { appId: props.app.id } })}
      action={<AddToSpace app={props.app} large onAdded={props.onAdded} />}
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
  onAdded: Added
}) {
  if (props.apps.length === 0 && !props.more) return <EmptyState>{Search.empty(props.query, props.empty)}</EmptyState>
  const rows = props.apps.map((app) => <CatalogAppRow key={app.id} app={app} onAdded={props.onAdded} />)
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
