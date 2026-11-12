import { useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { IconCode, IconCopy, IconPlayerPlay, IconTrash } from "@tabler/icons-react"
import { cn } from "cn"
import { toast } from "@ren/ui/sonner"
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
import { Separator } from "@ren/ui/separator"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@ren/ui/input-group"
import { Loading } from "@ren/ui/loading"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Spinner } from "@ren/ui/spinner"
import { Switch } from "@ren/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Tabs, TabsContent } from "@ren/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { formatRelative, localTimeZone } from "@ren/ui/time"
import { EmptyState } from "../../components/empty-state.js"
import { PageTabsList, PageTabsTrigger, Section, TableCard, TableSample, useShapeId } from "../../components/page.js"
import { RowMenu } from "../../components/row-menu.js"
import { Automations, type Automation, type Draft } from "../../lib/automations.js"
import { useAutomationActions, useAutomationRuns, useAutomations, type Run } from "../../lib/use-automations.js"
import { useMe } from "../../lib/use-me.js"
import { useMembers } from "../../lib/use-members.js"
import { useNow } from "../../lib/use-now.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { Webhooks } from "../../lib/webhooks.js"
import { AgentSelect } from "../../components/agent-select.js"
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

function SpaceChoice(props: { value: string; onChange: (spaceId: string) => void }) {
  const spaces = useSpaces().joined
  const items = spaces.map((space) => ({ value: space.id, label: space.name }))
  return (
    <Select items={items} value={props.value} onValueChange={(value) => props.onChange(String(value))}>
      <SelectTrigger size="sm" aria-label="Space" className="border-0 bg-transparent px-2 dark:bg-transparent">
        <SelectValue placeholder="Choose a space" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
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
      <TableCell className="text-muted-foreground">{run.status}</TableCell>
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
      <Section
        title="Triggers"
        description="When the agent runs: on a schedule, when a request reaches its URL, or both."
      >
        <TriggerList add={add}>{triggers}</TriggerList>
        <TriggerWarning webhook={props.automation?.webhook} active={draft.active} />
      </Section>
      <Section title="Agent instructions" description="What the agent does each time it runs, and which agent runs it.">
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
  onSave: () => void
  onCancel: () => void
  onTested: () => void
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
            <BreadcrumbPage className="max-w-64 truncate">{props.name}</BreadcrumbPage>
          </BreadcrumbItem>
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
                onClick={() => automation && void actions.test(automation).then(props.onTested)}
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

function EditorMeta(props: {
  draft: Draft
  automation: Automation | undefined
  onChange: (patch: Partial<Draft>) => void
}) {
  const members = useMembers()
  const spaces = useSpaces()
  const me = useMe()
  const automation = props.automation
  const owner = automation ? (members.member(automation.ownerId)?.name ?? "Someone") : me.user.name
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
      <label className="flex items-center gap-2">
        <Switch
          checked={props.draft.active}
          onCheckedChange={(active) => props.onChange({ active })}
          aria-label="Active"
        />
        <span className={cn(props.draft.active && "text-foreground")}>
          {props.draft.active ? "Active" : "Inactive"}
        </span>
      </label>
      <Separator orientation="vertical" className="h-4 self-center" />
      {automation ? (
        <span>{spaces.spaceName(automation.spaceId)}</span>
      ) : (
        <SpaceChoice
          value={props.draft.spaceId}
          onChange={(spaceId) => props.onChange({ spaceId, agent: Webhooks.defaultAgent })}
        />
      )}
      <Separator orientation="vertical" className="h-4 self-center" />
      <span>By {owner}</span>
    </div>
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
      if (!automation || saved.slug !== automation.slug) void open(saved)
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
        onSave={save}
        onCancel={() => (automation ? setDraft(initial) : void toList())}
        onTested={() => props.onTab("runs")}
        onOpen={(saved) => void open(saved)}
        onDeleted={() => void toList()}
      />
      <div className="mx-auto flex w-full max-w-200 flex-1 flex-col gap-6 px-6 pt-16 pb-12">
        <div className="flex flex-col gap-3">
          <Input
            aria-label="Name"
            placeholder="Untitled"
            value={draft.name}
            onChange={(event) => change({ name: event.target.value })}
            className="h-auto border-0 bg-transparent px-0 text-xl font-medium shadow-none focus-visible:ring-0 md:text-xl dark:bg-transparent"
          />
          <EditorMeta draft={draft} automation={automation} onChange={change} />
        </div>
        <Tabs value={props.tab} onValueChange={(tab) => props.onTab(tab === "runs" ? "runs" : "settings")}>
          <PageTabsList>
            <PageTabsTrigger value="settings">Settings</PageTabsTrigger>
            <PageTabsTrigger value="runs">Run history</PageTabsTrigger>
          </PageTabsList>
          <TabsContent value="settings" className="pt-6">
            <Settings draft={draft} automation={automation} onChange={change} />
          </TabsContent>
          <TabsContent value="runs" className="pt-6">
            <RunHistory automation={automation} />
          </TabsContent>
        </Tabs>
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
  if (!automation)
    return (
      <div className="mx-auto w-full max-w-200 px-6 pt-22">
        <EmptyState title="This automation is gone">It was deleted, or its link changed.</EmptyState>
      </div>
    )
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
