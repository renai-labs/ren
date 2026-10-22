import type { SpaceInfo, TaskCreateInput } from "@ren/client"
import { Task } from "@ren/schema/task"
import { Avatar } from "@ren/ui/avatar"
import { Combobox } from "@ren/ui/combobox"
import { Dialog } from "@ren/ui/dialog"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { Notice } from "@ren/ui/notice"
import { Form } from "@ren/ui/form"
import { Select } from "@ren/ui/select"
import { Switch } from "@ren/ui/switch"
import { Text } from "@ren/ui/text"
import { Schema } from "effect"
import { useId, useRef, useState } from "react"
import type { KeyboardEvent, ReactNode } from "react"
import { PropertyControls } from "./task-controls.js"
import type { Values } from "./task-controls.js"
import { Tasks } from "./tasks.js"

type Preset = { readonly agentId?: string | null; readonly status?: Task.Status }

type Draft = Pick<Values, "status" | "priority" | "agentId" | "ownerId" | "labels" | "dueAt">

const composerSchema = Schema.Struct({ title: Task.CreateInput.fields.title, description: Schema.String })

const blankDraft = (agentId: string | null, status: Task.Status | undefined): Draft => ({
  status: status ?? "todo",
  priority: null,
  agentId,
  ownerId: null,
  labels: [],
  dueAt: null,
})

const createInput = (spaceId: string, title: string, description: string, draft: Draft): TaskCreateInput => ({
  spaceId,
  title: title.trim(),
  ...(description.trim() && { description: description.trim() }),
  status: draft.status,
  ...(draft.priority && { priority: draft.priority }),
  ...(draft.agentId && { agentId: draft.agentId }),
  ...(draft.ownerId && { ownerId: draft.ownerId }),
  ...(draft.labels.length > 0 && { labels: draft.labels.map((label) => label.name) }),
  ...(draft.dueAt && { dueAt: draft.dueAt }),
})

export function TaskCreateDialog(props: {
  onClose: () => void
  spaces: ReadonlyArray<SpaceInfo>
  spaceId: string
  preset: Preset
  catalog: ReturnType<typeof Tasks.useCatalog>
}) {
  const actions = Tasks.useTaskActions()
  const pending = actions.isCreating
  const [expanded, setExpanded] = useState(false)
  const initialSpaceId = props.spaceId || (props.spaces[0]?.id ?? "")
  const [chosenSpaceId, setChosenSpaceId] = useState(initialSpaceId)
  const spaceId = props.spaces.some((space) => space.id === chosenSpaceId) ? chosenSpaceId : initialSpaceId
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      dismissal={pending ? "blocked" : "allowed"}
    >
      <Dialog.Content size={expanded ? "extra-wide" : "wide"} closeButton="hidden" placement="top">
        <TaskComposerHeader
          spaceField={
            <SpacePicker spaces={props.spaces} value={spaceId} onChange={setChosenSpaceId} disabled={pending} />
          }
          expanded={expanded}
          onExpandedChange={setExpanded}
          pending={pending}
        />
        {spaceId ? (
          <TaskComposer
            spaceId={spaceId}
            preset={props.preset}
            catalog={props.catalog}
            expanded={expanded}
            pending={pending}
            create={actions.create}
            onCreated={props.onClose}
          />
        ) : (
          <div className="px-6 pb-6">
            <Text purpose="body" tone="secondary">
              Create a space to start adding tasks.
            </Text>
          </div>
        )}
      </Dialog.Content>
    </Dialog.Root>
  )
}

function TaskComposerHeader(props: {
  spaceField: ReactNode
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  pending: boolean
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-4 pt-4 pb-2">
      {props.spaceField}
      <Icon glyph="ChevronRight" tone="secondary" />
      <Dialog.Title>New task</Dialog.Title>
      <Dialog.Description visibility="hidden">
        Add a task to a space. Assigning an agent does not start it.
      </Dialog.Description>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <div className="hidden sm:block">
          <IconButton
            onClick={() => props.onExpandedChange(!props.expanded)}
            label={props.expanded ? "Collapse task composer" : "Expand task composer"}
          >
            <Icon glyph={props.expanded ? "Minimize2" : "Maximize2"} />
          </IconButton>
        </div>
        <Dialog.Close
          disabled={props.pending}
          render={
            <IconButton label="Close task composer" disabled={props.pending}>
              <Icon glyph="X" />
            </IconButton>
          }
        />
      </div>
    </div>
  )
}

function SpacePicker(props: {
  spaces: ReadonlyArray<SpaceInfo>
  value: string
  onChange: (spaceId: string) => void
  disabled: boolean
}) {
  const space = props.spaces.find((entry) => entry.id === props.value)
  return (
    <Combobox.Popover
      label="Spaces"
      searchPlaceholder="Search"
      width="small"
      alignment="start"
      emptyMessage="No matches."
      value={props.value || null}
      onValueChange={(next) => {
        if (next !== null) props.onChange(next)
      }}
      groups={[
        {
          value: "spaces",
          label: "Spaces",
          items: props.spaces.map((entry) => ({
            value: entry.id,
            label: entry.name,
            icon: <Avatar.Root name={entry.name} glyph="Cube" size="extra-small" shape="square" decorative />,
          })),
        },
      ]}
      trigger={
        <Select.Button
          appearance="filled"
          shape="pill"
          size="small"
          indicator="chevron"
          disabled={props.disabled}
          label={`Space: ${space?.name ?? "none"}`}
          placeholder="Choose a space"
        >
          {space ? (
            <>
              <Avatar.Root name={space.name} glyph="Cube" size="extra-small" shape="square" decorative />
              {space.name}
            </>
          ) : null}
        </Select.Button>
      }
    />
  )
}

function TaskComposer(props: {
  spaceId: string
  preset: Preset
  catalog: ReturnType<typeof Tasks.useCatalog>
  expanded: boolean
  pending: boolean
  create: (input: TaskCreateInput) => Promise<unknown>
  onCreated: () => void
}) {
  const [draft, setDraft] = useState(() => blankDraft(props.preset.agentId ?? null, props.preset.status))
  const [scope, setScope] = useState(props.spaceId)
  if (scope !== props.spaceId) {
    setScope(props.spaceId)
    setDraft(blankDraft(null, props.preset.status))
  }
  const [createMore, setCreateMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const createMoreId = useId()

  const form = Form.useForm({
    defaultValues: { title: "", description: "" },
    schema: Schema.toStandardSchemaV1(composerSchema),
    onSubmit: async (value) => {
      setError(null)
      await props.create(createInput(props.spaceId, value.title, value.description, draft)).then(
        () => {
          form.reset()
          if (createMore) titleRef.current?.focus()
          else props.onCreated()
        },
        (failure: unknown) => {
          setError(Tasks.describe(failure))
        },
      )
    },
  })

  const submitOn = (event: KeyboardEvent<HTMLTextAreaElement>, options: { readonly modifier: boolean }) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return
    if (options.modifier && !(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    void form.handleSubmit()
  }

  return (
    <Form.Root form={form} label="Create task" arrangement="fill">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-6 pt-2 pb-4">
        <form.AppField name="title">
          {(field) => (
            <field.TextArea
              appearance="plain"
              height="automatic"
              size="title"
              ref={titleRef}
              label="Task title"
              onKeyDown={(event) => submitOn(event, { modifier: false })}
              disabled={props.pending}
              maxLength={Task.maximumTitleLength}
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog opens to take a task title
              autoFocus
              rows={1}
              placeholder="Task title"
            />
          )}
        </form.AppField>
        <form.AppField name="description">
          {(field) => (
            <field.TextArea
              appearance="plain"
              size="reading"
              height={props.expanded ? "expanded" : "growing"}
              label="Task description"
              onKeyDown={(event) => submitOn(event, { modifier: true })}
              disabled={props.pending}
              placeholder="Add description…"
            />
          )}
        </form.AppField>
      </div>
      <div className="px-4 pb-2">
        <PropertyControls
          presentation="chip"
          task={{ ...draft, spaceId: props.spaceId, title: "new task" }}
          agentName={draft.agentId === null ? undefined : props.catalog.agentName(draft.agentId)}
          owner={draft.ownerId === null ? undefined : props.catalog.person(draft.ownerId)}
          disabled={props.pending}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          onAssign={(assignment) => setDraft((current) => ({ ...current, ...assignment }))}
        />
      </div>
      <div className="flex items-center gap-4 px-4 pt-2 pb-4">
        <div className="min-w-0 flex-1">
          <Notice tone="danger" placement="inline">
            {error}
          </Notice>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Switch id={createMoreId} checked={createMore} onCheckedChange={setCreateMore} disabled={props.pending} />
          <Text purpose="caption" tone="primary" element="label" htmlFor={createMoreId}>
            Create more
          </Text>
        </div>
        <form.SubmitButton pendingLabel="Creating…">Create task</form.SubmitButton>
      </div>
    </Form.Root>
  )
}
