import { getRouteApi } from "@tanstack/react-router"
import { Page } from "../../components/page.js"
import { AutomationEditor, type EditorTab } from "./automation-editor.js"
import { AutomationsList, NewAutomationButton, type Tab } from "./automations-list.js"
import type { Automations } from "../../lib/automations.js"

const globalList = getRouteApi("/_authed/_shell/automations/")
const spaceList = getRouteApi("/_authed/_shell/spaces/$spaceId/automations/")
const globalNew = getRouteApi("/_authed/_shell/automations/new")
const globalEditor = getRouteApi("/_authed/_shell/automations/$spaceId/$slug")
const spaceEditor = getRouteApi("/_authed/_shell/spaces/$spaceId/automations/$slug")

const kindParam = (kind: Automations.ListKind) => (kind === "webhooks" ? "webhooks" : undefined)

export function AutomationsPage() {
  const search = globalList.useSearch()
  const navigate = globalList.useNavigate()
  return (
    <Page title="Automations" description="Agents that run on a schedule, or when another app sends a request.">
      <AutomationsList
        spaceId={undefined}
        tab={search.tab ?? "automations"}
        onTab={(tab: Tab) => void navigate({ search: { tab: tab === "runs" ? "runs" : undefined, kind: search.kind } })}
        kind={search.kind ?? "schedules"}
        onKind={(kind) => void navigate({ search: { kind: kindParam(kind) } })}
        onOpenRun={(session) => void navigate({ search: (previous) => ({ ...previous, session }) })}
        actions={<NewAutomationButton spaceId={undefined} />}
      />
    </Page>
  )
}

export function SpaceAutomationsTab() {
  const search = spaceList.useSearch()
  const navigate = spaceList.useNavigate()
  const spaceId = spaceList.useParams().spaceId
  return (
    <AutomationsList
      spaceId={spaceId}
      tab={search.tab ?? "automations"}
      onTab={(tab: Tab) => void navigate({ search: { tab: tab === "runs" ? "runs" : undefined, kind: search.kind } })}
      kind={search.kind ?? "schedules"}
      onKind={(kind) => void navigate({ search: { kind: kindParam(kind) } })}
      onOpenRun={(session) => void navigate({ search: (previous) => ({ ...previous, session }) })}
      actions={<NewAutomationButton spaceId={spaceId} />}
    />
  )
}

const editorTab = (tab: EditorTab) => (tab === "runs" ? "runs" : undefined)

export function NewAutomationPage() {
  const search = globalNew.useSearch()
  const navigate = globalNew.useNavigate()
  return (
    <AutomationEditor
      spaceId={undefined}
      slug="new"
      scoped={false}
      defaultSpace={search.space}
      tab={search.tab ?? "settings"}
      onTab={(tab) => void navigate({ search: (previous) => ({ ...previous, tab: editorTab(tab) }) })}
      onOpenRun={(session) => void navigate({ search: (previous) => ({ ...previous, session }) })}
    />
  )
}

export function AutomationEditorPage() {
  const params = globalEditor.useParams()
  const search = globalEditor.useSearch()
  const navigate = globalEditor.useNavigate()
  return (
    <AutomationEditor
      key={`${params.spaceId}/${params.slug}`}
      spaceId={params.spaceId}
      slug={params.slug}
      scoped={false}
      tab={search.tab ?? "settings"}
      onTab={(tab) => void navigate({ search: (previous) => ({ ...previous, tab: editorTab(tab) }) })}
      onOpenRun={(session) => void navigate({ search: (previous) => ({ ...previous, session }) })}
    />
  )
}

export function SpaceAutomationEditorPage() {
  const params = spaceEditor.useParams()
  const search = spaceEditor.useSearch()
  const navigate = spaceEditor.useNavigate()
  return (
    <AutomationEditor
      key={`${params.spaceId}/${params.slug}`}
      spaceId={params.spaceId}
      slug={params.slug}
      scoped
      tab={search.tab ?? "settings"}
      onTab={(tab) => void navigate({ search: (previous) => ({ ...previous, tab: editorTab(tab) }) })}
      onOpenRun={(session) => void navigate({ search: (previous) => ({ ...previous, session }) })}
    />
  )
}
