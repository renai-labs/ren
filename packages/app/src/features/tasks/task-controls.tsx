import type { LabelSummary, TaskInfo } from "@ren/client"
import { Task } from "@ren/schema/task"
import { Alert, AlertAction, AlertDescription } from "@ren/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { Combobox } from "@ren/ui/combobox"
import { Empty, EmptyDescription, EmptyHeader } from "@ren/ui/empty"
import { FormActions } from "@ren/ui/form-actions"
import { Icon } from "@ren/ui/icon"
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@ren/ui/item"
import { Popover, PopoverContent, PopoverTrigger } from "@ren/ui/popover"
import { SearchField } from "@ren/ui/search-field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Spinner } from "@ren/ui/spinner"
import { StatusDot } from "@ren/ui/status-dot"
import { TaskDueDate } from "@ren/ui/task-due-date"
import type { TaskControlPresentation } from "@ren/ui/task-due-date"
import { TaskLabel } from "@ren/ui/task-label"
import { TaskPriorityIcon } from "@ren/ui/task-priority-icon"
import { TaskStatusCircle } from "@ren/ui/task-status-circle"
import { Text } from "@ren/ui/text"
import { ToggleGroup, ToggleGroupItem } from "@ren/ui/toggle-group"
import { Initials } from "@ren/util/initials"
import { Result, Schema, SchemaIssue } from "effect"
import { useState } from "react"
import type { ReactNode } from "react"
import { TaskView } from "./task-view.js"
import { Tasks } from "./tasks.js"

export type Values = Pick<
  TaskInfo,
  "spaceId" | "title" | "status" | "priority" | "agentId" | "ownerId" | "labels" | "dueAt"
>

export type ControlProps = {
  task: Values
  presentation: TaskControlPresentation
  disabled?: boolean
  onChange?: ((patch: Tasks.Patch) => unknown) | undefined
  onAssign?: ((assignment: Tasks.Assignment) => unknown) | undefined
}

const selectTriggers = {
  chip: "gap-2 rounded-full px-3 text-xs font-medium data-[size=sm]:rounded-full *:[svg]:last:hidden",
  row: "-ml-2 gap-2 border-transparent px-2 disabled:opacity-100 data-[size=sm]:h-8 *:[svg]:last:hidden",
  icon: "justify-center rounded-full border-transparent p-0 text-muted-foreground data-[size=sm]:size-6 data-[size=sm]:rounded-full *:[svg]:last:hidden",
}

const buttonTriggers = {
  chip: { variant: "outline", size: "xs", className: "h-7 gap-2 rounded-full px-3" },
  row: { variant: "ghost", size: "default", className: "-ml-2 h-8 w-fit justify-start gap-2 px-2 font-normal" },
  icon: { variant: "ghost", size: "icon-xs", className: "rounded-full text-muted-foreground" },
} as const

const subject = (task: Values) => task.title || "new task"

export function PersonAvatar(props: { name: string; image?: string | null | undefined }) {
  return (
    <Avatar size="sm" className="data-[size=sm]:size-5" aria-hidden>
      {props.image ? <AvatarImage src={props.image} alt="" /> : null}
      <AvatarFallback className="bg-secondary">{Initials.of(props.name)}</AvatarFallback>
    </Avatar>
  )
}

export function SpaceAvatar() {
  return (
    <Avatar size="sm" className="rounded-md after:rounded-md data-[size=sm]:size-5" aria-hidden>
      <AvatarFallback className="rounded-md bg-secondary">
        <Icon glyph="Cube" size="extra-small" />
      </AvatarFallback>
    </Avatar>
  )
}

function InlineNote(props: { tone: "danger" | "neutral"; action?: ReactNode; children: ReactNode }) {
  return (
    <Alert
      variant={props.tone === "danger" ? "destructive" : "default"}
      role={props.tone === "danger" ? "alert" : "status"}
      className="border-0 bg-transparent p-0 has-data-[slot=alert-action]:pr-16"
    >
      <Icon glyph={props.tone === "danger" ? "AlertCircle" : "Info"} />
      <AlertDescription>{props.children}</AlertDescription>
      {props.action ? <AlertAction className="top-0 right-0">{props.action}</AlertAction> : null}
    </Alert>
  )
}

export function PropertyControls(
  props: ControlProps & { agentName: string | undefined; owner: Tasks.Person | undefined },
) {
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a fieldset would add a border and a form context the controls do not use
      role="group"
      aria-label="Task properties"
      className="flex flex-wrap items-center gap-2"
    >
      <StatusControl {...props} />
      <PriorityControl {...props} />
      <AgentControl {...props} />
      <OwnerControl {...props} />
      <LabelsControl {...props} />
      <DueDateControl {...props} />
    </div>
  )
}

export function StatusControl(props: ControlProps) {
  const save = usePropertySave(props.onChange)
  return (
    <>
      <Select
        items={TaskView.statuses.map((status) => ({ label: TaskView.statusLabel[status], value: status }))}
        value={props.task.status}
        disabled={props.disabled === true || !props.onChange || save.pending}
        onValueChange={(status) => {
          if (status !== null) save.change({ status })
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label={`Status for ${subject(props.task)}: ${TaskView.statusLabel[props.task.status]}`}
          className={selectTriggers[props.presentation]}
        >
          <SelectValue>
            {(status: Task.Status) =>
              triggerContent(props.presentation, <TaskStatusCircle status={status} />, TaskView.statusLabel[status])
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="start" className="w-48">
          <SelectGroup>
            {TaskView.statuses.map((status) => (
              <SelectItem key={status} value={status}>
                <TaskStatusCircle status={status} />
                {TaskView.statusLabel[status]}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {save.error ? <InlineNote tone="danger">{save.error}</InlineNote> : null}
    </>
  )
}

export function PriorityControl(props: ControlProps) {
  const save = usePropertySave(props.onChange)
  const options: ReadonlyArray<{ value: Task.Priority | typeof TaskView.none; label: string }> = [
    { value: TaskView.none, label: TaskView.priorityLabel(null) },
    ...TaskView.priorities.map((priority) => ({ value: priority, label: TaskView.priorityLabel(priority) })),
  ]
  return (
    <>
      <Select<Task.Priority | typeof TaskView.none>
        items={options}
        value={props.task.priority ?? TaskView.none}
        disabled={props.disabled === true || !props.onChange || save.pending}
        onValueChange={(value) => {
          if (value !== null) save.change({ priority: value === TaskView.none ? null : value })
        }}
      >
        <SelectTrigger
          size="sm"
          aria-label={`Priority for ${subject(props.task)}: ${TaskView.priorityLabel(props.task.priority)}`}
          className={selectTriggers[props.presentation]}
        >
          <SelectValue>
            {() =>
              triggerContent(
                props.presentation,
                <TaskPriorityIcon priority={props.task.priority} />,
                props.presentation === "chip" && !props.task.priority
                  ? "Priority"
                  : TaskView.priorityLabel(props.task.priority),
              )
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="start" className="w-48">
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <TaskPriorityIcon priority={option.value === TaskView.none ? null : option.value} />
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {save.error ? <InlineNote tone="danger">{save.error}</InlineNote> : null}
    </>
  )
}

function usePropertySave(onChange: ControlProps["onChange"]) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return {
    pending,
    error,
    change: (patch: Tasks.Patch) => {
      if (pending) return
      setPending(true)
      setError(null)
      void Promise.resolve()
        .then(() => onChange?.(patch))
        .then(
          () => setPending(false),
          (cause: unknown) => {
            setPending(false)
            setError(Tasks.describe(cause))
          },
        )
    },
  }
}

function triggerContent(presentation: TaskControlPresentation, glyph: ReactNode, text: string) {
  if (presentation === "icon") return glyph
  return (
    <>
      {glyph}
      <span className="truncate" title={text}>
        {text}
      </span>
    </>
  )
}

type Saving = { readonly id: string | null; readonly name: string; readonly failure: string | null }

function useAssignment(onPick: (id: string | null) => unknown, onDone: () => void) {
  const [saving, setSaving] = useState<Saving | null>(null)
  const pending = saving?.failure === null
  const assign = (id: string | null, name: string) => {
    if (pending) return
    setSaving({ id, name, failure: null })
    void Promise.resolve()
      .then(() => onPick(id))
      .then(
        () => {
          setSaving(null)
          onDone()
        },
        (error: unknown) => setSaving({ id, name, failure: Tasks.describe(error) }),
      )
  }
  return { saving, pending, assign, clear: () => setSaving(null) }
}

function AssignFooter(props: { saving: Saving | null; onRetry: (saving: Saving) => void }) {
  const saving = props.saving
  if (saving === null) return null
  if (saving.failure === null) return <InlineNote tone="neutral">Saving {saving.name}…</InlineNote>
  return (
    <InlineNote
      tone="danger"
      action={
        <Button variant="ghost" size="xs" onClick={() => props.onRetry(saving)}>
          Retry
        </Button>
      }
    >
      {saving.failure}
    </InlineNote>
  )
}

type PickerProps = {
  presentation: TaskControlPresentation
  property: string
  heading: string
  header?: string
  empty: string
  none: string
  noneIcon: ReactNode
  value: string | null
  current: { readonly name: string; readonly glyph: ReactNode } | undefined
  subject: string
  disabled: boolean
  state: "ready" | "loading" | "failed"
  options: ReadonlyArray<{ readonly id: string; readonly name: string; readonly icon: ReactNode }>
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (id: string | null) => unknown
}

function Picker(props: PickerProps) {
  const assignment = useAssignment(props.onPick, () => props.onOpenChange(false))
  const blocked = props.disabled || assignment.pending
  const label = props.value ? (props.current?.name ?? props.property) : props.empty
  const trigger = buttonTriggers[props.presentation]
  return (
    <Combobox.Popover
      label={props.heading}
      searchPlaceholder={`Search ${props.property.toLowerCase()}…`}
      width="medium"
      density="spacious"
      alignment={props.presentation === "icon" ? "end" : "start"}
      open={props.open}
      onOpenChange={(next) => {
        if (assignment.pending) return
        if (!next) assignment.clear()
        props.onOpenChange(next)
      }}
      closeOnSelect={false}
      value={props.value ?? TaskView.none}
      onValueChange={(next) => {
        if (next === null) return
        const id = next === TaskView.none ? null : next
        assignment.assign(
          id,
          id === null ? props.empty : (props.options.find((option) => option.id === id)?.name ?? props.property),
        )
      }}
      state={props.state}
      failureMessage={`Couldn’t load ${props.property.toLowerCase()} options.`}
      emptyMessage={props.options.length > 0 ? "No matches." : props.none}
      header={props.header}
      footer={
        <AssignFooter saving={assignment.saving} onRetry={(saving) => assignment.assign(saving.id, saving.name)} />
      }
      groups={[
        {
          value: "none",
          items: [{ value: TaskView.none, label: props.empty, icon: props.noneIcon, disabled: blocked }],
        },
        {
          value: "choices",
          label: props.heading,
          items: props.options.map((option) => ({
            value: option.id,
            label: option.name,
            icon: option.icon,
            disabled: blocked,
          })),
        },
      ]}
      trigger={
        <Button
          variant={trigger.variant}
          size={trigger.size}
          className={trigger.className}
          disabled={blocked}
          aria-label={`${props.property} for ${props.subject}: ${label}`}
        >
          {props.value
            ? triggerContent(props.presentation, props.current?.glyph ?? props.noneIcon, label)
            : triggerContent(
                props.presentation,
                props.noneIcon,
                props.presentation === "chip" ? props.property : label,
              )}
        </Button>
      }
    />
  )
}

const queryStates = { pending: "loading", error: "failed", success: "ready" } as const

export function AgentControl(props: ControlProps & { agentName: string | undefined }) {
  const [open, setOpen] = useState(false)
  const agents = Tasks.useSpaceAgents(props.task.spaceId || undefined, { enabled: open })
  const glyph = <Icon glyph="Bot" tone="secondary" />
  return (
    <Picker
      presentation={props.presentation}
      property="Agent"
      heading="Assign to an agent"
      header="Assigning an agent does not start it."
      empty="No agent"
      none="No agents in this space."
      noneIcon={glyph}
      value={props.task.agentId}
      current={props.agentName === undefined ? undefined : { name: props.agentName, glyph }}
      subject={subject(props.task)}
      disabled={props.disabled === true || !props.onAssign}
      state={queryStates[agents.status]}
      options={(agents.data ?? []).map((agent) => ({ id: agent.id, name: agent.name, icon: glyph }))}
      open={open}
      onOpenChange={setOpen}
      onPick={(agentId) => props.onAssign?.({ agentId })}
    />
  )
}

export function OwnerControl(props: ControlProps & { owner: Tasks.Person | undefined }) {
  const [open, setOpen] = useState(false)
  const owners = Tasks.useSpaceOwners(props.task.spaceId, { enabled: open })
  return (
    <Picker
      presentation={props.presentation}
      property="Owner"
      heading="Assign an owner"
      empty="No owner"
      none="No people in this space."
      noneIcon={<Icon glyph="UnassignedPerson" tone="secondary" />}
      value={props.task.ownerId}
      current={
        props.owner && {
          name: props.owner.name,
          glyph: <PersonAvatar name={props.owner.name} image={props.owner.image} />,
        }
      }
      subject={subject(props.task)}
      disabled={props.disabled === true || !props.onAssign}
      state={queryStates[owners.status]}
      options={(owners.data ?? []).map((person) => ({
        id: person.id,
        name: person.name,
        icon: <PersonAvatar name={person.name} image={person.image} />,
      }))}
      open={open}
      onOpenChange={setOpen}
      onPick={(ownerId) => props.onAssign?.({ ownerId })}
    />
  )
}

export function ParentControl(props: ControlProps & { task: TaskInfo }) {
  const [open, setOpen] = useState(false)
  const candidates = Tasks.useParentCandidates(props.task, { enabled: open })
  const glyph = <Icon glyph="Subtask" tone="secondary" />
  return (
    <Picker
      presentation={props.presentation}
      property="Parent"
      heading="Set parent task"
      header="A sub-task stays in its parent’s space."
      empty="No parent"
      none="No other tasks in this space."
      noneIcon={glyph}
      value={props.task.parentId}
      current={props.task.parent ? { name: `Sub-task of ${props.task.parent.title}`, glyph } : undefined}
      subject={subject(props.task)}
      disabled={props.disabled === true || !props.onChange}
      state={queryStates[candidates.status]}
      options={(candidates.data ?? []).map((candidate) => ({
        id: candidate.id,
        name: `${candidate.identifier} ${candidate.title}`,
        icon: <TaskStatusCircle status={candidate.status} />,
      }))}
      open={open}
      onOpenChange={setOpen}
      onPick={(parentId) => props.onChange?.({ parentId })}
    />
  )
}

export function DueDateControl(props: ControlProps) {
  return (
    <TaskDueDate
      value={props.task.dueAt?.slice(0, 10) ?? null}
      closed={props.task.status === "done" || props.task.status === "dismissed"}
      presentation={props.presentation}
      label={`Due date for ${subject(props.task)}`}
      disabled={props.disabled === true}
      onChange={props.onChange && ((value) => props.onChange?.({ dueAt: value && `${value}T00:00:00.000Z` }))}
    />
  )
}

const colors: Record<string, string> = {
  danger: "Red",
  accent: "Indigo",
  neutral: "Teal",
  warning: "Amber",
  success: "Green",
}

const decodeLabelName = Schema.decodeUnknownResult(Task.LabelName)

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1()

const tooMany = `Use at most ${Task.maximumLabels} labels.`

const swatchFor = (name: string) =>
  TaskLabel.swatches.find((swatch) => swatch.tone === TaskLabel.tone({ name }))?.hex ?? TaskLabel.swatches[0]?.hex ?? ""

const nameProblem = (name: string, count: number) => {
  if (count > Task.maximumLabels) return tooMany
  const result = decodeLabelName(name)
  if (Result.isFailure(result)) return formatIssues(result.failure.issue).issues[0]?.message ?? "Check the label name."
  return null
}

export function LabelsControl(props: ControlProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<ReadonlyArray<LabelSummary> | null>(null)
  const [query, setQuery] = useState("")
  const [naming, setNaming] = useState<string | null>(null)
  const [color, setColor] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const labels = Tasks.useLabels({ enabled: open, spaceId: props.task.spaceId })
  const create = Tasks.useCreateLabel()
  const selected = draft ?? props.task.labels
  const catalog = [
    ...selected,
    ...(labels.data?.items ?? []).filter(
      (label) => !label.isSystem && !selected.some((entry) => entry.id === label.id),
    ),
  ]
  const needle = query.trim().toLowerCase()
  const change = (next: ReadonlyArray<LabelSummary>) => {
    const problem = next.length > Task.maximumLabels ? tooMany : null
    setError(problem)
    if (problem === null) setDraft(next)
  }
  const commit = async () => {
    if (pending) return
    const changed =
      draft !== null &&
      !TaskView.sameValues(
        draft.map((label) => label.id),
        props.task.labels.map((label) => label.id),
      )
    setPending(true)
    const saved =
      !changed ||
      (await Promise.try(() => props.onChange?.({ labels: [...draft] })).then(
        () => true,
        (cause: unknown) => {
          setError(Tasks.describe(cause))
          return false
        },
      ))
    setPending(false)
    if (!saved) return
    setOpen(false)
    setDraft(null)
    setQuery("")
    setError(null)
  }
  const confirm = () => {
    if (naming === null || create.isPending) return
    const problem = nameProblem(naming, selected.length + 1)
    setError(problem)
    if (problem !== null) return
    void create.mutateAsync({ spaceId: props.task.spaceId, name: naming, color }).then(
      (label) => {
        change([...selected, label])
        setNaming(null)
        setQuery("")
      },
      (failure: unknown) => setError(Tasks.describe(failure)),
    )
  }
  const trigger = labelsTrigger(props)
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (!next) {
          void commit()
          return
        }
        setDraft(props.task.labels)
        setNaming(null)
        setOpen(next)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant={trigger.variant}
            size={trigger.size}
            className={trigger.className}
            disabled={props.disabled === true || !props.onChange}
            aria-label={`Labels for ${subject(props.task)}: ${
              props.task.labels.map((label) => TaskLabel.display(label.name)).join(", ") || "none"
            }`}
          />
        }
      >
        {trigger.children}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72" aria-label="Labels">
        {naming === null ? (
          <LabelSearchPanel
            query={query}
            onQueryChange={setQuery}
            matching={catalog.filter(
              (label) =>
                !needle || label.name.toLowerCase().includes(needle) || TaskLabel.display(label.name).includes(needle),
            )}
            selected={selected}
            creatable={
              needle !== "" &&
              !catalog.some((label) => label.name.toLowerCase() === needle || TaskLabel.display(label.name) === needle)
            }
            onToggle={(label) => {
              if (label.isSystem) return
              change(
                selected.some((entry) => entry.id === label.id)
                  ? selected.filter((entry) => entry.id !== label.id)
                  : [...selected, label],
              )
            }}
            onCreate={() => {
              const name = query.trim()
              if (!name) return
              setColor(swatchFor(name))
              setNaming(name)
            }}
            loading={open && labels.isPending}
            failed={labels.isError}
            error={error}
          />
        ) : (
          <LabelCreatePanel
            name={naming}
            color={color}
            pending={create.isPending}
            error={error}
            onColorChange={setColor}
            onCancel={() => setNaming(null)}
            onConfirm={confirm}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function LabelSearchPanel(props: {
  query: string
  onQueryChange: (query: string) => void
  matching: ReadonlyArray<LabelSummary>
  selected: ReadonlyArray<LabelSummary>
  creatable: boolean
  onToggle: (label: LabelSummary) => void
  onCreate: () => void
  loading: boolean
  failed: boolean
  error: string | null
}) {
  return (
    <div className="flex flex-col gap-2">
      <SearchField.Root
        value={props.query}
        onValueChange={props.onQueryChange}
        placeholder="Search or create labels…"
        size="medium"
        appearance="outline"
        icon="hidden"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the popover opens to search or create a label
        autoFocus
        onKeyDown={(event) => {
          if (event.key !== "Enter") return
          event.preventDefault()
          const first = props.matching[0]
          if (props.creatable) props.onCreate()
          else if (first) props.onToggle(first)
        }}
      />
      <div className="flex flex-col">
        <ItemGroup aria-label="Labels" className="max-h-64 overflow-y-auto overscroll-contain has-data-[size=xs]:gap-0">
          {props.matching.map((label) => {
            const checked = props.selected.some((entry) => entry.id === label.id)
            return (
              <Item
                key={label.id}
                size="xs"
                className="h-auto justify-start text-left font-normal"
                render={
                  <Button
                    variant="ghost"
                    disabled={label.isSystem}
                    aria-pressed={checked}
                    onClick={() => props.onToggle(label)}
                  />
                }
              >
                <ItemMedia>
                  <StatusDot tone={TaskLabel.tone(label)} />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{TaskLabel.display(label.name)}</ItemTitle>
                </ItemContent>
                {checked ? (
                  <ItemActions>
                    <Icon glyph="Check" size="extra-small" tone="secondary" />
                  </ItemActions>
                ) : null}
              </Item>
            )
          })}
          {props.creatable ? (
            <Item
              size="xs"
              className="h-auto justify-start text-left font-normal"
              render={<Button variant="ghost" onClick={props.onCreate} />}
            >
              <ItemMedia>
                <Icon glyph="Plus" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Create label “{props.query.trim()}”</ItemTitle>
              </ItemContent>
            </Item>
          ) : null}
        </ItemGroup>
        {props.loading ? (
          <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">
            <Spinner />
            Loading labels…
          </div>
        ) : null}
        {props.failed ? <InlineNote tone="danger">Couldn’t load labels.</InlineNote> : null}
        {props.matching.length === 0 && !props.creatable && !props.loading ? (
          <Empty className="p-2">
            <EmptyHeader>
              <EmptyDescription>No labels yet. Type to create one.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </div>
      {props.error ? <InlineNote tone="danger">{props.error}</InlineNote> : null}
    </div>
  )
}

function LabelCreatePanel(props: {
  name: string
  color: string
  pending: boolean
  error: string | null
  onColorChange: (color: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Enter anywhere in the panel creates the label, as it does in the search step
    <div
      className="flex flex-col gap-3"
      onKeyDown={(event) => {
        if (event.key !== "Enter") return
        event.preventDefault()
        props.onConfirm()
      }}
    >
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back to label search" onClick={props.onCancel}>
          <Icon glyph="ChevronLeft" />
        </Button>
        <Text purpose="label" element="span" truncation="single-line">
          New label “{TaskLabel.display(props.name)}”
        </Text>
      </div>
      <ToggleGroup
        aria-label="Label color"
        variant="outline"
        size="sm"
        spacing={1}
        value={[props.color]}
        onValueChange={(next) => {
          const color = next.at(0)
          if (color) props.onColorChange(color)
        }}
      >
        {TaskLabel.swatches.map((swatch) => (
          <ToggleGroupItem key={swatch.hex} value={swatch.hex}>
            <StatusDot tone={swatch.tone} label={colors[swatch.tone] ?? swatch.hex} />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {props.error ? <InlineNote tone="danger">{props.error}</InlineNote> : null}
      <FormActions.Root>
        <Button variant="ghost" size="sm" disabled={props.pending} onClick={props.onCancel}>
          Cancel
        </Button>
        <Button variant="outline" size="sm" disabled={props.pending} onClick={props.onConfirm}>
          {props.pending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
          {props.pending ? "Creating…" : "Create label"}
        </Button>
      </FormActions.Root>
    </div>
  )
}

function labelsTrigger(props: ControlProps) {
  const labels = props.task.labels
  const fit = {
    variant: "ghost",
    size: "default",
    className: "h-auto max-w-full rounded-full px-0 hover:bg-transparent",
  } as const
  if (props.presentation === "icon")
    return labels.length > 0
      ? { ...fit, children: <TaskLabel.Chips labels={labels} /> }
      : {
          ...buttonTriggers.icon,
          className:
            "rounded-full text-muted-foreground focus-visible:opacity-100 data-popup-open:opacity-100 sm:opacity-0 sm:group-hover/board-card:opacity-100 sm:group-hover/task-row:opacity-100",
          children: <Icon glyph="Plus" />,
        }
  if (props.presentation === "row" && labels.length > 0)
    return {
      ...fit,
      children: (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {labels.map((label) => (
            <TaskLabel.Pill key={label.id} label={label} />
          ))}
          <Icon glyph="Plus" tone="secondary" />
        </span>
      ),
    }
  if (props.presentation === "row")
    return {
      ...buttonTriggers.row,
      className: "-ml-2 h-8 w-fit justify-start gap-2 px-2 font-normal text-muted-foreground",
      children: (
        <>
          <Icon glyph="Tag" />
          Add label
        </>
      ),
    }
  return {
    ...buttonTriggers.chip,
    children:
      labels.length > 0 ? (
        <>
          <TaskLabel.Dots labels={labels} />
          {labels.length === 1 ? TaskLabel.display(labels.at(0)?.name ?? "") : `${labels.length} labels`}
        </>
      ) : (
        <>
          <Icon glyph="Tag" />
          Labels
        </>
      ),
  }
}
