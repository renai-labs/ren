import { useRef, useState } from "react"
import type { WebhookInfo } from "@ren/client"
import { Link, useBlocker, useNavigate } from "@tanstack/react-router"
import { IconChevronRight, IconCode, IconCopy, IconHistory, IconPlayerPlay, IconTrash } from "@tabler/icons-react"
import { toast } from "@ren/ui/sonner"
import { cn } from "cn"
import { Button, buttonVariants } from "@ren/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ren/ui/collapsible"
import { Field, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Input } from "@ren/ui/input"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@ren/ui/input-group"
import { Loading } from "@ren/ui/loading"
import { Spinner } from "@ren/ui/spinner"
import { Switch } from "@ren/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ren/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { RelativeTime } from "@ren/util/relative-time"
import { localTimeZone } from "@ren/ui/time"
import { Equal } from "effect"
import { ConfirmDialog } from "../../components/confirm-dialog.js"
import { EmptyState } from "../../components/empty-state.js"
import { RouteNotFound } from "../../components/route-error.js"
import { Section, TableCard, TableSample, useShapeId } from "../../components/page.js"
import { RowMenu } from "../../components/row-menu.js"
import { Automations, type Automation, type Draft } from "../../lib/automations.js"
import type { Cadence } from "../../lib/schedules.js"
import {
  useAppPresets,
  useAutomationActions,
  useAutomation,
  useAutomationRuns,
  type AppPreset,
  type Run,
  type Saved,
} from "../../lib/use-automations.js"
import { useMe } from "../../lib/use-me.js"
import { useMembers } from "../../lib/use-members.js"
import { useNow } from "../../lib/use-now.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { Webhooks } from "../../lib/webhooks.js"
import { AgentPicker } from "../../components/agent-select.js"
import { Breadcrumb } from "../../components/breadcrumb.js"
import { TimeZonePicker } from "../../components/time-zone-picker.js"
import { WorkingIn } from "../../components/working-in.js"
import { TaskLayout } from "../../components/task-layout.js"
import { DarkUi } from "../../lib/dark-ui.js"
import { RunStatus } from "./run-status.js"
import { AddTrigger, DatePicker, ScheduleTrigger, TriggerList, TriggerWarning, WebhookTrigger } from "./triggers.js"

export type EditorTab = "settings" | "runs"

interface Scope {
  readonly scoped: boolean
  readonly spaceId: string | undefined
}

function ListLink(props: { scope: Scope; children: React.ReactNode }) {
  if (props.scope.scoped && props.scope.spaceId)
    return (
      <Link to="/spaces/$spaceId/automations" params={{ spaceId: props.scope.spaceId }}>
        {props.children}
      </Link>
    )
  return <Link to="/automations">{props.children}</Link>
}

function RunHistory(props: { automation: Automation | undefined; onOpenRun: (sessionId: string) => void }) {
  const now = useNow()
  const shapeId = useShapeId("automation-run-history")
  const history = useAutomationRuns(props.automation)
  const columns = ["Trigger", "Triggered", "Status", ""]
  if (history.failed) return <EmptyState title="Couldn’t load its runs">Reload the page to try again.</EmptyState>
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
                <RunRow key={run.id} run={run} webhook={props.automation?.webhook} now={now} onOpen={props.onOpenRun} />
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </Loading>
  )
}

function RunRow(props: {
  run: Run
  webhook: WebhookInfo | undefined
  now: number
  onOpen: (sessionId: string) => void
}) {
  const run = props.run
  const session = run.sessionId
  const request = props.webhook && run.requestId ? { webhook: props.webhook, id: run.requestId } : undefined
  return (
    <TableRow className={session ? "relative cursor-pointer" : undefined}>
      <TableCell className="align-top">{run.trigger}</TableCell>
      <TableCell className="align-top text-muted-foreground">{RelativeTime.format(run.at, props.now)}</TableCell>
      <TableCell className="max-w-80 align-top whitespace-normal">
        <RunStatus tone={run.tone}>{run.status}</RunStatus>
        {run.detail ? (
          <span className="mt-1 line-clamp-2 text-xs break-words text-muted-foreground" title={run.detail}>
            {run.detail}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="text-right align-top">
        {session ? (
          <Button
            variant="link"
            onClick={() => props.onOpen(session)}
            className="h-auto p-0 font-normal text-foreground after:absolute after:inset-0 focus-visible:ring-0 focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
          >
            Open chat
          </Button>
        ) : null}
        {!session && request ? (
          <Link
            to="/spaces/$spaceId/automations/webhooks/$webhookId"
            params={{ spaceId: request.webhook.spaceId, webhookId: request.webhook.id }}
            search={{ tab: "requests", request: request.id }}
            className="text-sm hover:underline"
          >
            Details
          </Link>
        ) : null}
      </TableCell>
    </TableRow>
  )
}

function Advanced(props: {
  draft: Draft
  automation: Automation | undefined
  onChange: (patch: Partial<Draft>) => void
}) {
  const draft = props.draft
  const cadence = Automations.cadenceOfDraft(draft)
  const setCadence = (patch: Partial<Cadence>) =>
    props.onChange({ trigger: cadence && { kind: "schedule", cadence: { ...cadence, ...patch } } })
  const webhook = props.automation?.webhook
  if (!cadence && draft.trigger?.kind !== "webhook") return null
  return (
    <Collapsible>
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" className="group/disclosure -ml-2 text-muted-foreground" />}
      >
        <IconChevronRight
          data-icon="inline-start"
          className="transition-transform duration-150 ease-out group-aria-expanded/disclosure:rotate-90 motion-reduce:transition-none"
        />
        Advanced
      </CollapsibleTrigger>
      <CollapsibleContent>
        <FieldGroup className="gap-4 pt-3">
          {cadence ? (
            <>
              <Field orientation="horizontal" className="justify-between">
                <FieldLabel>Time zone</FieldLabel>
                <TimeZonePicker value={cadence.timeZone} onChange={(timeZone) => setCadence({ timeZone })} />
              </Field>
              {cadence.frequency === "once" ? null : (
                <Field orientation="horizontal" className="justify-between">
                  <FieldLabel>Ends</FieldLabel>
                  <span className="flex items-center gap-2">
                    <DatePicker
                      label="End date"
                      placeholder="Never"
                      value={cadence.until}
                      onChange={(until) => setCadence({ until, ...(until === "" && { untilTime: "" }) })}
                    />
                    {cadence.until ? (
                      <Button variant="ghost" size="sm" onClick={() => setCadence({ until: "", untilTime: "" })}>
                        Clear
                      </Button>
                    ) : null}
                  </span>
                </Field>
              )}
              <Field orientation="horizontal" className="justify-between">
                <FieldLabel>Each run</FieldLabel>
                {draft.target === "new-chat" ? (
                  <span className="text-sm text-muted-foreground">Starts a new chat</span>
                ) : (
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Link to="/sessions/$sessionId" params={{ sessionId: draft.target.sessionId }}>
                      Goes to one chat
                    </Link>
                    <Button variant="ghost" size="sm" onClick={() => props.onChange({ target: "new-chat" })}>
                      Start a new chat instead
                    </Button>
                  </span>
                )}
              </Field>
            </>
          ) : null}
          {draft.trigger?.kind === "webhook" ? (
            <Field orientation="horizontal" className="justify-between">
              <FieldLabel>If the owner leaves the space</FieldLabel>
              <FallbackSelect value={draft.fallback} onChange={(fallback) => props.onChange({ fallback })} />
            </Field>
          ) : null}
          {webhook ? (
            <Field orientation="horizontal" className="justify-between">
              <FieldLabel>Requests, filter and signature</FieldLabel>
              <Link
                to="/spaces/$spaceId/automations/webhooks/$webhookId"
                params={{ spaceId: webhook.spaceId, webhookId: webhook.id }}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                Webhook settings
              </Link>
            </Field>
          ) : null}
        </FieldGroup>
      </CollapsibleContent>
    </Collapsible>
  )
}

function FallbackSelect(props: { value: string | null; onChange: (fallback: string | null) => void }) {
  const me = useMe()
  const members = useMembers()
  const other = props.value && props.value !== me.user.id ? props.value : undefined
  const items = [
    { value: "debug", label: "Switch it to Debug" },
    { value: me.user.id, label: "Run it as me" },
    ...(other
      ? [
          {
            value: other,
            label: `Run it as ${members.member(other)?.name ?? "another member"}`,
          },
        ]
      : []),
  ]
  return (
    <Select
      items={items}
      value={props.value ?? "debug"}
      onValueChange={(value) => props.onChange(value === "debug" || value === null ? null : value)}
    >
      <SelectTrigger size="sm" aria-label="If the owner leaves the space">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
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

const webhookLabelOf = (
  preset: Automations.PresetRef | null,
  presets: ReadonlyArray<AppPreset>,
  saved: WebhookInfo | undefined,
) => {
  if (!preset) return "Webhook"
  const found = presets.find((each) => Automations.presetKey(each) === Automations.presetKey(preset))
  if (found) return `${found.appName} · ${found.name}`
  return saved?.preset ? `${saved.preset.appName} · ${saved.name}` : "Webhook"
}

function TriggerSection(props: {
  draft: Draft
  automation: Automation | undefined
  onChange: (patch: Partial<Draft>) => void
}) {
  const actions = useAutomationActions()
  const draft = props.draft
  const zone = localTimeZone()
  const cadence = Automations.cadenceOfDraft(draft)
  const kind = draft.trigger?.kind
  const preset = Automations.presetOfDraft(draft)
  const presets = useAppPresets(draft.spaceId)
  const saved = props.automation
  const webhook = saved?.webhook
  const remove = saved ? undefined : () => props.onChange({ trigger: undefined })
  const scheduleRow = cadence ? (
    <ScheduleTrigger
      cadence={cadence}
      active={draft.active}
      onChange={(patch) => props.onChange({ trigger: { kind: "schedule", cadence: { ...cadence, ...patch } } })}
      onRemove={remove}
    />
  ) : null
  const webhookRow =
    kind === "webhook" ? (
      <WebhookTrigger
        webhook={webhook}
        label={webhookLabelOf(preset, presets, webhook)}
        spaceId={draft.spaceId}
        onCopyUrl={(webhook) => void actions.copyUrl(webhook)}
        onCopyAuthHeader={(webhook) => void actions.copyAuthHeader(webhook)}
        onRemove={remove}
      />
    ) : null
  const add = webhook ? null : (
    <AddTrigger
      current={preset ? Automations.presetKey(preset) : kind}
      only={saved ? "schedule" : undefined}
      presets={presets}
      onSchedule={(frequency) =>
        props.onChange({ trigger: { kind: "schedule", cadence: Automations.startCadence(frequency, zone, cadence) } })
      }
      onWebhook={() => props.onChange({ trigger: { kind: "webhook", preset: null } })}
      onPreset={(chosen) =>
        props.onChange({
          trigger: { kind: "webhook", preset: { appId: chosen.appId, preset: chosen.preset } },
          name: `${chosen.appName} · ${chosen.name}`,
          message: chosen.message,
        })
      }
    />
  )
  return (
    <Section title="Trigger">
      <TriggerList add={add}>{scheduleRow ?? webhookRow}</TriggerList>
      <TriggerWarning webhook={webhook} active={draft.active} />
    </Section>
  )
}

function Settings(props: {
  draft: Draft
  automation: Automation | undefined
  onChange: (patch: Partial<Draft>) => void
}) {
  const draft = props.draft
  const preset = Automations.presetOfDraft(draft)
  return (
    <div className="flex flex-col gap-10">
      <TriggerSection draft={draft} automation={props.automation} onChange={props.onChange} />
      <Section
        title="Agent instructions"
        description={preset ? "The app sets the instructions of its webhooks." : undefined}
      >
        <InputGroup>
          <InputGroupTextarea
            aria-label="Agent instructions"
            placeholder="What should the agent do each time this runs?"
            readOnly={preset !== null}
            value={draft.message}
            onChange={(event) => props.onChange({ message: event.target.value })}
            className="min-h-40"
          />
          <InputGroupAddon align="block-end">
            {draft.spaceId ? (
              <AgentPicker
                spaceId={draft.spaceId}
                value={draft.agent}
                onChange={(agent) => props.onChange({ agent })}
              />
            ) : null}
          </InputGroupAddon>
        </InputGroup>
      </Section>
      <Advanced draft={draft} automation={props.automation} onChange={props.onChange} />
    </div>
  )
}

const testBlockOf = (automation: Automation | undefined, draft: { readonly changed: boolean }) => {
  if (!automation) return "Save to test it"
  return draft.changed ? "Save first" : null
}

function EditorHeader(props: {
  name: string
  scope: Scope
  automation: Automation | undefined
  changed: boolean
  saving: boolean
  runs: boolean
  onSave: () => void
  onCancel: () => void
  onOpen: (saved: Saved) => void
  onDeleted: () => void
}) {
  const actions = useAutomationActions()
  const automation = props.automation
  const blocked = testBlockOf(automation, { changed: props.changed })
  return (
    <Breadcrumb.Header className="gap-2">
      <div className="mr-auto flex min-w-0 items-center">
        <Breadcrumb.Root
          ancestorsFrom="md"
          ancestors={[
            { key: "automations", content: <ListLink scope={props.scope}>Automations</ListLink> },
            ...(props.runs
              ? [
                  {
                    key: "automation",
                    content: (
                      <Link to="." search={{}} className="max-w-64">
                        <span className="truncate">{props.name}</span>
                      </Link>
                    ),
                  },
                ]
              : []),
          ]}
        >
          <span className="block truncate">{props.runs ? "Runs" : props.name}</span>
        </Breadcrumb.Root>
      </div>
      {props.changed ? (
        <Button variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      ) : null}
      <Button onClick={props.onSave} disabled={!props.changed || props.saving}>
        {props.saving ? <Spinner data-icon="inline-start" /> : null}
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
            ...(props.changed
              ? []
              : [
                  {
                    label: "Duplicate",
                    icon: IconCopy,
                    onSelect: () => actions.duplicate(automation).then(props.onOpen),
                  },
                ]),
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
    </Breadcrumb.Header>
  )
}

function SpaceRow(props: {
  draft: Draft
  automation: Automation | undefined
  onChange: (patch: Partial<Draft>) => void
}) {
  const spaces = useSpaces()
  return (
    <WorkingIn
      spaces={spaces.joined}
      spaceId={props.draft.spaceId}
      disabled={props.automation !== undefined}
      label={null}
      className="-ml-1"
      onChange={(spaceId) => props.onChange({ spaceId, agent: Webhooks.defaultAgent })}
    />
  )
}

function Editor(props: {
  automation: Automation | undefined
  initialSpace: string
  scope: Scope
  tab: EditorTab
  onTab: (tab: EditorTab) => void
  onOpenRun: (sessionId: string) => void
}) {
  const navigate = useNavigate()
  const actions = useAutomationActions()
  const [initial, setInitial] = useState(() =>
    Automations.draftOf(props.automation, props.initialSpace, localTimeZone()),
  )
  const [draft, setDraft] = useState(initial)
  const automation = props.automation
  const changed = !Equal.equals(draft, initial)
  const change = (patch: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...patch }))
  const leaving = useRef(false)
  const blocker = useBlocker({
    shouldBlockFn: (move) => changed && !leaving.current && move.current.pathname !== move.next.pathname,
    enableBeforeUnload: changed,
    withResolver: true,
  })
  const open = (saved: Saved) => {
    const params = { spaceId: saved.spaceId, slug: saved.handle }
    return props.scope.scoped
      ? navigate({ to: "/spaces/$spaceId/automations/$slug", params, replace: true })
      : navigate({ to: "/automations/$spaceId/$slug", params, replace: true })
  }
  const toList = () => {
    leaving.current = true
    return props.scope.scoped && props.scope.spaceId
      ? navigate({ to: "/spaces/$spaceId/automations", params: { spaceId: props.scope.spaceId } })
      : navigate({ to: "/automations" })
  }
  const save = () => {
    if (actions.saving) return
    const problem = Automations.problemOf(draft)
    if (problem) {
      toast.error(problem)
      return
    }
    void actions.save(draft, automation).then((saved) => {
      toast.success(automation ? "Automation saved" : "Automation created")
      setInitial(draft)
      if (automation) return
      leaving.current = true
      void open(saved)
    })
  }
  const name = Automations.nameOrDefault(draft.name)
  const deep = DarkUi.useDarkUi()
  const nameInput = (
    <Input
      aria-label="Name"
      data-detail-title=""
      placeholder="Untitled"
      readOnly={Automations.presetOfDraft(draft) !== null}
      value={draft.name}
      onChange={(event) => change({ name: event.target.value })}
      className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 text-xl font-medium shadow-none focus-visible:ring-0 max-md:basis-full md:text-xl dark:bg-transparent"
    />
  )
  const history =
    automation && props.tab !== "runs" ? (
      <Button variant="ghost" className="text-muted-foreground" onClick={() => props.onTab("runs")}>
        <IconHistory data-icon="inline-start" />
        Run history
      </Button>
    ) : null
  const active = (
    // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the label wraps a Base UI Switch, which renders a button
    <label data-property="active" className="flex items-center gap-2 text-sm text-muted-foreground">
      Active
      <Switch checked={draft.active} onCheckedChange={(active) => change({ active })} />
    </label>
  )
  const body =
    props.tab === "runs" ? (
      <RunHistory automation={automation} onOpenRun={props.onOpenRun} />
    ) : (
      <Settings draft={draft} automation={automation} onChange={change} />
    )
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <EditorHeader
        name={name}
        scope={props.scope}
        automation={automation}
        changed={changed}
        saving={actions.saving}
        runs={props.tab === "runs"}
        onSave={save}
        onCancel={() => (automation ? setDraft(initial) : void toList())}
        onOpen={(saved) => void open(saved)}
        onDeleted={() => void toList()}
      />
      {deep ? (
        <div className={TaskLayout.scroller}>
          <div data-slot="detail-body" className={TaskLayout.body}>
            <div data-slot="detail-main" className={TaskLayout.article}>
              {nameInput}
              {body}
            </div>
            <aside aria-label="Automation properties" data-slot="detail-aside" className={TaskLayout.aside}>
              <section className="flex flex-col">
                <h2 className={TaskLayout.sectionTitle}>Properties</h2>
                {active}
                <SpaceRow draft={draft} automation={automation} onChange={change} />
                {history}
              </section>
            </aside>
          </div>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-200 flex-1 flex-col gap-6 px-6 pt-16 pb-12">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 max-md:flex-wrap">
              {nameInput}
              {history}
              {active}
            </div>
            <SpaceRow draft={draft} automation={automation} onChange={change} />
          </div>
          {body}
        </div>
      )}
      {blocker.status === "blocked" ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) blocker.reset()
          }}
          confirmation={{
            title: "Discard your changes?",
            description: `${name} has changes you haven’t saved.`,
            action: "Discard",
            cancel: "Keep editing",
          }}
          onConfirm={() => blocker.proceed()}
        />
      ) : null}
    </div>
  )
}

// oxlint-disable-next-line ren/no-comments -- Creates an automation, or edits one found in its space by its address.
export function AutomationEditor(props: {
  spaceId: string | undefined
  slug: string
  scoped: boolean
  tab: EditorTab
  onTab: (tab: EditorTab) => void
  onOpenRun: (sessionId: string) => void
  defaultSpace?: string | undefined
}) {
  const spaces = useSpaces()
  const scope = { scoped: props.scoped, spaceId: props.spaceId }
  if (props.slug === Automations.newSlug || !props.spaceId)
    return (
      <Editor
        automation={undefined}
        initialSpace={props.spaceId ?? props.defaultSpace ?? spaces.joined.at(0)?.id ?? ""}
        scope={scope}
        tab={props.tab}
        onTab={props.onTab}
        onOpenRun={props.onOpenRun}
      />
    )
  return <SavedEditor {...props} spaceId={props.spaceId} scope={scope} />
}

function SavedEditor(props: {
  spaceId: string
  slug: string
  scope: Scope
  tab: EditorTab
  onTab: (tab: EditorTab) => void
  onOpenRun: (sessionId: string) => void
}) {
  const found = useAutomation(props.spaceId, props.slug)
  if (found.loading)
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Spinner aria-label="Loading automation" />
      </div>
    )
  if (!found.automation)
    return found.failed ? (
      <EmptyState title="Couldn’t load the automation">Reload the page to try again.</EmptyState>
    ) : (
      <RouteNotFound />
    )
  return (
    <Editor
      key={found.automation.key}
      automation={found.automation}
      initialSpace={found.automation.spaceId}
      scope={props.scope}
      tab={props.tab}
      onTab={props.onTab}
      onOpenRun={props.onOpenRun}
    />
  )
}
