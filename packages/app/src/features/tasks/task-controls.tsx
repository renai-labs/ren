import type { LabelSummary, TaskInfo } from "@ren/client"
import { Task } from "@ren/schema/task"
import { Avatar } from "@ren/ui/avatar"
import { Button } from "@ren/ui/button"
import { Combobox } from "@ren/ui/combobox"
import { FormActions } from "@ren/ui/form-actions"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { List } from "@ren/ui/list"
import { LoadingMessage } from "@ren/ui/loading-message"
import { Notice } from "@ren/ui/notice"
import { Popover } from "@ren/ui/popover"
import { SearchField } from "@ren/ui/search-field"
import { SegmentedControl } from "@ren/ui/segmented-control"
import { Select } from "@ren/ui/select"
import { StateMessage } from "@ren/ui/state-message"
import { StatusDot } from "@ren/ui/status-dot"
import { TaskDueDate } from "@ren/ui/task-due-date"
import type { TaskControlPresentation } from "@ren/ui/task-due-date"
import { TaskLabel } from "@ren/ui/task-label"
import { TaskPriorityIcon } from "@ren/ui/task-priority-icon"
import { TaskStatusCircle } from "@ren/ui/task-status-circle"
import { Text } from "@ren/ui/text"
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

const triggers = {
  chip: { appearance: "chip", shape: "pill", size: "small", indicator: "none" },
  row: { appearance: "property", shape: "pill", size: "small", indicator: "none" },
  icon: { appearance: "plain", shape: "square", size: "small", indicator: "none" },
} as const

const subject = (task: Values) => task.title || "new task"

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
      <Select.Root<Task.Status>
        value={props.task.status}
        disabled={props.disabled === true || !props.onChange || save.pending}
        onValueChange={(status) => save.change({ status })}
        label={`Status for ${subject(props.task)}: ${TaskView.statusLabel[props.task.status]}`}
        {...triggers[props.presentation]}
        {...(props.presentation === "icon" && { renderValue: (option) => option?.icon })}
        options={TaskView.statuses.map((status) => ({
          value: status,
          icon: <TaskStatusCircle status={status} />,
          label: TaskView.statusLabel[status],
        }))}
      />
      {save.error ? (
        <Notice tone="danger" placement="inline">
          {save.error}
        </Notice>
      ) : null}
    </>
  )
}

export function PriorityControl(props: ControlProps) {
  const save = usePropertySave(props.onChange)
  return (
    <>
      <Select.Root<Task.Priority | typeof TaskView.none>
        value={props.task.priority ?? TaskView.none}
        disabled={props.disabled === true || !props.onChange || save.pending}
        onValueChange={(value) => save.change({ priority: value === TaskView.none ? null : value })}
        label={`Priority for ${subject(props.task)}: ${TaskView.priorityLabel(props.task.priority)}`}
        {...triggers[props.presentation]}
        {...(props.presentation === "icon" && { renderValue: (option) => option?.icon })}
        {...(props.presentation === "chip" &&
          !props.task.priority && {
            renderValue: () => (
              <>
                <TaskPriorityIcon priority={null} />
                <Text purpose="caption" tone="secondary" element="span">
                  Priority
                </Text>
              </>
            ),
          })}
        options={[
          { value: TaskView.none, icon: <TaskPriorityIcon priority={null} />, label: TaskView.priorityLabel(null) },
          ...TaskView.priorities.map((priority) => ({
            value: priority,
            icon: <TaskPriorityIcon priority={priority} />,
            label: TaskView.priorityLabel(priority),
          })),
        ]}
      />
      {save.error ? (
        <Notice tone="danger" placement="inline">
          {save.error}
        </Notice>
      ) : null}
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
      <Text
        purpose={presentation === "chip" ? "caption" : "label"}
        weight={presentation === "chip" ? "medium" : "regular"}
        tone="inherit"
        element="span"
        truncation="single-line"
        title={text}
      >
        {text}
      </Text>
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
  if (saving.failure === null)
    return (
      <Notice tone="neutral" placement="inline">
        Saving {saving.name}…
      </Notice>
    )
  return (
    <Notice
      tone="danger"
      placement="inline"
      action={
        <Button appearance="plain" size="small" onClick={() => props.onRetry(saving)}>
          Retry
        </Button>
      }
    >
      {saving.failure}
    </Notice>
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
      trigger={<Select.Button {...pickerButton(props, { label, disabled: blocked })} />}
    />
  )
}

function pickerButton(
  props: PickerProps,
  state: { readonly label: string; readonly disabled: boolean },
): Select.ButtonProps {
  return {
    ...triggers[props.presentation],
    shape: props.presentation === "icon" ? "circle" : triggers[props.presentation].shape,
    disabled: state.disabled,
    label: `${props.property} for ${props.subject}: ${state.label}`,
    placeholder: triggerContent(
      props.presentation,
      props.noneIcon,
      props.presentation === "chip" ? props.property : state.label,
    ),
    children: props.value
      ? triggerContent(props.presentation, props.current?.glyph ?? props.noneIcon, state.label)
      : null,
  }
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
  const avatar = (person: Tasks.Person, size: "extra-small" | "compact", tone: "inverse" | "accent") => (
    <Avatar.Root name={person.name} image={person.image} size={size} tone={tone} decorative />
  )
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
          glyph: avatar(props.owner, props.presentation === "icon" ? "compact" : "extra-small", "inverse"),
        }
      }
      subject={subject(props.task)}
      disabled={props.disabled === true || !props.onAssign}
      state={queryStates[owners.status]}
      options={(owners.data ?? []).map((person) => ({
        id: person.id,
        name: person.name,
        icon: avatar(person, "compact", "accent"),
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
  return (
    <Popover.Root
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
      <Popover.Trigger render={<Select.Button {...labelsButton(props)} />} />
      <Popover.Content alignment="start" padding="small" label="Labels">
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
      </Popover.Content>
    </Popover.Root>
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
        <List.Root frame="flush" height="limited" label="Labels">
          {props.matching.map((label) => {
            const checked = props.selected.some((entry) => entry.id === label.id)
            return (
              <List.Item
                key={label.id}
                density="compact"
                disabled={label.isSystem}
                selected={checked}
                selectionMark="checkbox"
                onActivate={() => props.onToggle(label)}
                leading={<StatusDot tone={TaskLabel.tone(label)} />}
                title={TaskLabel.display(label.name)}
                trailing={checked ? <Icon glyph="Check" size="extra-small" tone="secondary" /> : undefined}
              />
            )
          })}
          {props.creatable ? (
            <List.Item
              density="compact"
              onActivate={props.onCreate}
              leading={<Icon glyph="Plus" />}
              title={`Create label “${props.query.trim()}”`}
            />
          ) : null}
        </List.Root>
        {props.loading ? <LoadingMessage placement="inline" title="Loading labels…" /> : null}
        {props.failed ? <StateMessage state="failed" placement="inline" title="Couldn’t load labels." /> : null}
        {props.matching.length === 0 && !props.creatable && !props.loading ? (
          <StateMessage state="empty" placement="inline" title="No labels yet. Type to create one." />
        ) : null}
      </div>
      <Notice tone="danger" placement="inline">
        {props.error}
      </Notice>
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
        <IconButton size="small" label="Back to label search" onClick={props.onCancel}>
          <Icon glyph="ChevronLeft" />
        </IconButton>
        <Text purpose="label" element="span" truncation="single-line">
          New label “{TaskLabel.display(props.name)}”
        </Text>
      </div>
      <SegmentedControl
        size="small"
        label="Label color"
        value={props.color}
        onValueChange={props.onColorChange}
        options={TaskLabel.swatches.map((swatch) => ({
          value: swatch.hex,
          label: <StatusDot tone={swatch.tone} label={colors[swatch.tone] ?? swatch.hex} />,
        }))}
      />
      <Notice tone="danger" placement="inline">
        {props.error}
      </Notice>
      <FormActions.Root>
        <Button appearance="plain" size="small" disabled={props.pending} onClick={props.onCancel}>
          Cancel
        </Button>
        <Button
          appearance="secondary"
          size="small"
          pending={props.pending}
          pendingLabel="Creating…"
          onClick={props.onConfirm}
        >
          Create label
        </Button>
      </FormActions.Root>
    </div>
  )
}

function labelsButton(props: ControlProps): Select.ButtonProps {
  const labels = props.task.labels
  const shared = {
    ...triggers[props.presentation],
    disabled: props.disabled === true || !props.onChange,
    label: `Labels for ${subject(props.task)}: ${
      labels.map((label) => TaskLabel.display(label.name)).join(", ") || "none"
    }`,
  }
  if (props.presentation === "icon")
    return labels.length > 0
      ? { ...shared, shape: "fit", children: <TaskLabel.Chips labels={labels} /> }
      : { ...shared, visibility: "on-container-hover", children: <Icon glyph="Plus" /> }
  if (props.presentation === "row" && labels.length > 0)
    return {
      ...shared,
      shape: "fit",
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
      ...shared,
      placeholder: (
        <>
          <Icon glyph="Tag" />
          Add label
        </>
      ),
    }
  return {
    ...shared,
    placeholder: (
      <>
        <Icon glyph="Tag" />
        Labels
      </>
    ),
    children:
      labels.length > 0 ? (
        <>
          <TaskLabel.Dots labels={labels} />
          {labels.length === 1 ? TaskLabel.display(labels[0]?.name ?? "") : `${labels.length} labels`}
        </>
      ) : null,
  }
}
