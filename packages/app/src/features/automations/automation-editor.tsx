import { useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { IconAlertTriangle, IconArrowUpRight, IconCode, IconCopy, IconPlayerPlay, IconTrash } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { Alert, AlertDescription } from "@ren/ui/alert"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@ren/ui/breadcrumb"
import { Button } from "@ren/ui/button"
import { Input } from "@ren/ui/input"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@ren/ui/input-group"
import { Loading } from "@ren/ui/loading"
import { Spinner } from "@ren/ui/spinner"
import { Switch } from "@ren/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { formatRelative, localTimeZone } from "@ren/ui/time"
import { EmptyState } from "../../components/empty-state.js"
import { RouteNotFound } from "../../components/route-error.js"
import { Section, TableCard, TableSample, useShapeId } from "../../components/page.js"
import { RowMenu } from "../../components/row-menu.js"
import { Automations, type Automation, type Draft } from "../../lib/automations.js"
import { useAutomationActions, useAutomationRuns, useAutomations, type Run } from "../../lib/use-automations.js"
import { useNow } from "../../lib/use-now.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { Webhooks } from "../../lib/webhooks.js"
import { AgentSelect } from "../../components/agent-select.js"
import { WorkingIn } from "../../components/working-in.js"
import { RunStatus } from "./run-status.js"
import { AddTrigger, ScheduleTrigger, TriggerList, TriggerWarning, WebhookTrigger } from "./triggers.js"

export type EditorTab = "settings" | "runs"

interface Scope {
  readonly scoped: boolean
  readonly spaceId: string | undefined
}

function ListLink(props: { scope: Scope; children: React.ReactNode }) {
  if (props.scope.scoped && props.scope.spaceId)
    return (
      <BreadcrumbLink render={<Link to="/spaces/$spaceId/automations" params={{ spaceId: props.scope.spaceId }} />}>
        {props.children}
      </BreadcrumbLink>
    )
  return <BreadcrumbLink render={<Link to="/automations" />}>{props.children}</BreadcrumbLink>
}

function RunHistory(props: { automation: Automation | undefined }) {
  const now = useNow()
  const shapeId = useShapeId("automation-run-history")
  const history = useAutomationRuns(props.automation)
  const columns = ["Trigger", "Triggered", "Status", ""]
  if (!history.loading && history.runs.length === 0)
    return <EmptyState title="No runs yet">Runs from the last 30 days show here.</EmptyState>
  return (
    <Loading id={shapeId} loading={history.loading} label="Loading runs">
      {history.loading ? (
        <TableSample columns={columns} />
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.runs.map((run) => (
                <RunRow key={run.id} run={run} now={now} />
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </Loading>
  )
}

function RunRow(props: { run: Run; now: number }) {
  const run = props.run
  return (
    <TableRow>
      <TableCell>{run.trigger}</TableCell>
      <TableCell className="text-muted-foreground">{formatRelative(run.at, props.now)}</TableCell>
      <TableCell>
        <RunStatus tone={run.tone}>{run.status}</RunStatus>
      </TableCell>
      <TableCell className="text-right">
        {run.sessionId ? (
          <Link to="/sessions/$sessionId" params={{ sessionId: run.sessionId }} className="text-sm">
            Open chat
          </Link>
        ) : null}
      </TableCell>
    </TableRow>
  )
}

function Settings(props: {
  draft: Draft
  automation: Automation | undefined
  onChange: (patch: Partial<Draft>) => void
}) {
  const actions = useAutomationActions()
  const draft = props.draft
  const zone = localTimeZone()
  const taken = [...(draft.schedule ? (["schedule"] as const) : []), ...(draft.webhook ? (["webhook"] as const) : [])]
  const triggers = [
    ...(draft.schedule
      ? [
          <ScheduleTrigger
            key="schedule"
            cadence={draft.schedule}
            onChange={(patch) => props.onChange({ schedule: draft.schedule && { ...draft.schedule, ...patch } })}
            onRemove={() => props.onChange({ schedule: undefined })}
          />,
        ]
      : []),
    ...(draft.webhook
      ? [
          <WebhookTrigger
            key="webhook"
            webhook={props.automation?.webhook}
            spaceId={draft.spaceId}
            onCopyUrl={(webhook) => void actions.copyUrl(webhook)}
            onCopyAuthHeader={(webhook) => void actions.copyAuthHeader(webhook)}
            onRemove={() => props.onChange({ webhook: false })}
          />,
        ]
      : []),
  ]
  const add = (
    <AddTrigger
      taken={taken}
      onSchedule={(frequency) => props.onChange({ schedule: Automations.startCadence(frequency, zone) })}
      onWebhook={() => props.onChange({ webhook: true })}
    />
  )
  return (
    <div className="flex flex-col gap-10">
      <Section title="Triggers">
        <TriggerList add={add}>{triggers}</TriggerList>
        <TriggerWarning webhook={props.automation?.webhook} active={draft.active} />
      </Section>
      <Section title="Agent instructions">
        <InputGroup>
          <InputGroupTextarea
            aria-label="Agent instructions"
            placeholder="What should the agent do each time this runs?"
            value={draft.message}
            onChange={(event) => props.onChange({ message: event.target.value })}
            className="min-h-40"
          />
          <InputGroupAddon align="block-end">
            {draft.spaceId ? (
              <AgentSelect
                spaceId={draft.spaceId}
                value={draft.agent}
                onChange={(agent) => props.onChange({ agent })}
                className="w-auto"
              />
            ) : null}
          </InputGroupAddon>
        </InputGroup>
      </Section>
    </div>
  )
}

const testBlockOf = (automation: Automation | undefined, draft: { readonly changed: boolean }) => {
  if (!automation?.schedule) return "Add a schedule and save to test it"
  return draft.changed ? "Save first" : null
}

function EditorHeader(props: {
  name: string
  scope: Scope
  automation: Automation | undefined
  changed: boolean
  runs: boolean
  onSave: () => void
  onCancel: () => void
  onOpen: (saved: { readonly spaceId: string; readonly slug: string }) => void
  onDeleted: () => void
}) {
  const actions = useAutomationActions()
  const automation = props.automation
  const blocked = testBlockOf(automation, { changed: props.changed })
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 px-3 pt-2">
      <Breadcrumb className="mr-auto flex h-8 items-center rounded-lg border bg-sidebar px-3">
        <BreadcrumbList className="gap-2">
          <BreadcrumbItem>
            <ListLink scope={props.scope}>Automations</ListLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            {props.runs ? (
              <BreadcrumbLink render={<Link to="." search={{}} />} className="max-w-64 truncate">
                {props.name}
              </BreadcrumbLink>
            ) : (
              <BreadcrumbPage className="max-w-64 truncate">{props.name}</BreadcrumbPage>
            )}
          </BreadcrumbItem>
          {props.runs ? (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Runs</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : null}
        </BreadcrumbList>
      </Breadcrumb>
      {props.changed ? (
        <Button variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      ) : null}
      <Button onClick={props.onSave} disabled={!props.changed || actions.saving}>
        {actions.saving ? <Spinner data-icon="inline-start" /> : null}
        Save
      </Button>
      <Tooltip>
        <TooltipTrigger
          render={
            <span>
              <Button
                variant="outline"
                disabled={blocked !== null || actions.testing}
                onClick={() => automation && void actions.test(automation)}
              >
                <IconPlayerPlay data-icon="inline-start" />
                Test
              </Button>
            </span>
          }
        />
        {blocked ? <TooltipContent>{blocked}</TooltipContent> : null}
      </Tooltip>
      {automation ? (
        <RowMenu
          label={`${props.name} actions`}
          items={[
            { label: "Duplicate", icon: IconCopy, onSelect: () => actions.duplicate(automation).then(props.onOpen) },
            { label: "Copy as JSON", icon: IconCode, onSelect: () => actions.copyJson(automation) },
            {
              label: "Delete",
              icon: IconTrash,
              onSelect: () => actions.remove(automation).then(props.onDeleted),
              confirm: {
                title: `Delete ${props.name}?`,
                description: "Its triggers stop and its webhook URL stops working. Chats it started stay.",
                action: "Delete",
              },
            },
          ]}
        />
      ) : null}
    </header>
  )
}

function SpaceRow(props: {
  draft: Draft
  automation: Automation | undefined
  onChange: (patch: Partial<Draft>) => void
}) {
  const spaces = useSpaces()
  const automation = props.automation
  return (
    <>
      <WorkingIn
        spaces={spaces.joined}
        spaceId={props.draft.spaceId}
        side="bottom"
        label={null}
        className="ml-0 px-0 hover:bg-transparent dark:hover:bg-transparent"
        onChange={(spaceId) => props.onChange({ spaceId, agent: Webhooks.defaultAgent })}
      />
      {automation && props.draft.spaceId !== automation.spaceId ? (
        <Alert>
          <IconAlertTriangle />
          <AlertDescription>
            Saving moves it to {spaces.spaceName(props.draft.spaceId)}.
            {automation.webhook ? " Its webhook gets a new URL and auth header." : ""}
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  )
}

function Editor(props: {
  automation: Automation | undefined
  initialSpace: string
  scope: Scope
  tab: EditorTab
  onTab: (tab: EditorTab) => void
}) {
  const navigate = useNavigate()
  const actions = useAutomationActions()
  const [initial, setInitial] = useState(() =>
    Automations.draftOf(props.automation, props.initialSpace, localTimeZone()),
  )
  const [draft, setDraft] = useState(initial)
  const automation = props.automation
  const changed = JSON.stringify(draft) !== JSON.stringify(initial)
  const change = (patch: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...patch }))
  const open = (saved: { readonly spaceId: string; readonly slug: string }) =>
    props.scope.scoped
      ? navigate({ to: "/spaces/$spaceId/automations/$slug", params: saved, replace: true })
      : navigate({ to: "/automations/$spaceId/$slug", params: saved, replace: true })
  const toList = () =>
    props.scope.scoped && props.scope.spaceId
      ? navigate({ to: "/spaces/$spaceId/automations", params: { spaceId: props.scope.spaceId } })
      : navigate({ to: "/automations" })
  const save = () => {
    const problem = Automations.problemOf(draft)
    if (problem) {
      toast.error(problem)
      return
    }
    void actions.save(draft, automation).then((saved) => {
      toast.success(automation ? "Automation saved" : "Automation created")
      setInitial(draft)
      if (!automation || saved.slug !== automation.slug || saved.spaceId !== automation.spaceId) void open(saved)
    })
  }
  const name = Automations.nameOrDefault(draft.name)
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <EditorHeader
        name={name}
        scope={props.scope}
        automation={automation}
        changed={changed}
        runs={props.tab === "runs"}
        onSave={save}
        onCancel={() => (automation ? setDraft(initial) : void toList())}
        onOpen={(saved) => void open(saved)}
        onDeleted={() => void toList()}
      />
      <div className="mx-auto flex w-full max-w-200 flex-1 flex-col gap-6 px-6 pt-16 pb-12">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <Input
              aria-label="Name"
              placeholder="Untitled"
              value={draft.name}
              onChange={(event) => change({ name: event.target.value })}
              className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 text-xl font-medium shadow-none focus-visible:ring-0 md:text-xl dark:bg-transparent"
            />
            {automation && props.tab !== "runs" ? (
              <Button variant="ghost" className="text-muted-foreground" onClick={() => props.onTab("runs")}>
                Runs
                <IconArrowUpRight data-icon="inline-end" />
              </Button>
            ) : null}
            <Switch checked={draft.active} onCheckedChange={(active) => change({ active })} aria-label="Active" />
          </div>
          <SpaceRow draft={draft} automation={automation} onChange={change} />
        </div>
        {props.tab === "runs" ? (
          <RunHistory automation={automation} />
        ) : (
          <Settings draft={draft} automation={automation} onChange={change} />
        )}
      </div>
    </div>
  )
}

// oxlint-disable-next-line ren/no-comments -- Creates or edits one automation. The list of its space gives the schedule and the webhook that share its slug.
export function AutomationEditor(props: {
  spaceId: string | undefined
  slug: string
  scoped: boolean
  tab: EditorTab
  onTab: (tab: EditorTab) => void
  defaultSpace?: string | undefined
}) {
  const creating = props.slug === Automations.newSlug
  const spaces = useSpaces()
  const list = useAutomations(props.spaceId)
  const scope = { scoped: props.scoped, spaceId: props.spaceId }
  if (creating)
    return (
      <Editor
        automation={undefined}
        initialSpace={props.spaceId ?? props.defaultSpace ?? spaces.joined.at(0)?.id ?? ""}
        scope={scope}
        tab={props.tab}
        onTab={props.onTab}
      />
    )
  const automation = list.automations?.find((each) => each.slug === props.slug)
  if (!list.automations)
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Spinner aria-label="Loading automation" />
      </div>
    )
  if (!automation) return <RouteNotFound />
  return (
    <Editor
      key={automation.key}
      automation={automation}
      initialSpace={automation.spaceId}
      scope={scope}
      tab={props.tab}
      onTab={props.onTab}
    />
  )
}
