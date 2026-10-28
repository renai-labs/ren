import type { SpaceInfo, TaskCreateInput } from "@ren/client"
import { Task } from "@ren/schema/task"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Button } from "@ren/ui/button"
import { Combobox } from "@ren/ui/combobox"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@ren/ui/dialog"
import { Icon } from "@ren/ui/icon"
import { Form } from "@ren/ui/form"
import { Label } from "@ren/ui/label"
import { Switch } from "@ren/ui/switch"
import { Text } from "@ren/ui/text"
import { Schema } from "effect"
import { useId, useRef, useState } from "react"
import type { KeyboardEvent } from "react"
import { PropertyControls, SpaceAvatar } from "./task-controls.js"
import type { Values } from "./task-controls.js"
import { Tasks } from "./tasks.js"

export type Preset = { readonly agentId?: string | null; readonly status?: Task.Status; readonly parentId?: string }

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

const createInput = (
  spaceId: string,
  preset: Preset,
  title: string,
  description: string,
  draft: Draft,
): TaskCreateInput => ({
  spaceId,
  ...(preset.parentId && { parentId: preset.parentId }),
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) props.onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={
          expanded ? "top-[12%] translate-y-0 gap-0 p-0 sm:max-w-256" : "top-[12%] translate-y-0 gap-0 p-0 sm:max-w-192"
        }
      >
        <div className="flex min-w-0 items-center gap-2 px-4 pt-4 pb-2">
          <SpacePicker spaces={props.spaces} value={spaceId} onChange={setChosenSpaceId} disabled={pending} />
          <Icon glyph="ChevronRight" tone="secondary" />
          <DialogTitle>New task</DialogTitle>
          <DialogDescription className="sr-only">
            Add a task to a space. Assigning an agent does not start it.
          </DialogDescription>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="hidden text-muted-foreground sm:inline-flex"
              aria-label={expanded ? "Collapse task composer" : "Expand task composer"}
              onClick={() => setExpanded(!expanded)}
            >
              <Icon glyph={expanded ? "Minimize2" : "Maximize2"} />
            </Button>
            <DialogClose
              disabled={pending}
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label="Close task composer"
                  disabled={pending}
                />
              }
            >
              <Icon glyph="X" />
            </DialogClose>
          </div>
        </div>
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
      </DialogContent>
    </Dialog>
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
            icon: <SpaceAvatar />,
          })),
        },
      ]}
      trigger={
        <Button
          variant="outline"
          size="xs"
          className="h-7 rounded-full px-3 font-normal text-foreground"
          disabled={props.disabled}
          aria-label={`Space: ${space?.name ?? "none"}`}
        >
          {space ? <SpaceAvatar /> : null}
          {space ? space.name : "Choose a space"}
          <Icon glyph="ChevronDown" tone="secondary" data-icon="inline-end" />
        </Button>
      }
    />
  )
}

export function TaskComposer(props: {
  spaceId: string
  preset: Preset
  catalog: ReturnType<typeof Tasks.useCatalog>
  expanded: boolean
  pending: boolean
  create: (input: TaskCreateInput) => Promise<unknown>
  onCreated: () => void
  onCancel?: () => void
}) {
  const noun = props.preset.parentId ? { lower: "sub-task", title: "Sub-task" } : { lower: "task", title: "Task" }
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
      await props.create(createInput(props.spaceId, props.preset, value.title, value.description, draft)).then(
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
    if (event.nativeEvent.isComposing) return
    if (event.key === "Escape" && props.onCancel && !props.pending) {
      event.preventDefault()
      props.onCancel()
      return
    }
    if (event.key !== "Enter") return
    if (options.modifier && !(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    void form.handleSubmit()
  }

  return (
    <Form.Root form={form} label={`Create ${noun.lower}`} arrangement="fill">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-6 pt-2 pb-4">
        <form.AppField name="title">
          {(field) => (
            <field.TextArea
              appearance="plain"
              height="automatic"
              size="title"
              ref={titleRef}
              label={`${noun.title} title`}
              onKeyDown={(event) => submitOn(event, { modifier: false })}
              disabled={props.pending}
              maxLength={Task.maximumTitleLength}
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the composer opens to take a task title
              autoFocus
              rows={1}
              placeholder={`${noun.title} title`}
            />
          )}
        </form.AppField>
        <form.AppField name="description">
          {(field) => (
            <field.TextArea
              appearance="plain"
              size="reading"
              height={props.expanded ? "expanded" : "growing"}
              label={`${noun.title} description`}
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
          {error ? (
            <Alert variant="destructive" className="border-0 bg-transparent p-0">
              <Icon glyph="AlertCircle" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Switch id={createMoreId} checked={createMore} onCheckedChange={setCreateMore} disabled={props.pending} />
          <Label htmlFor={createMoreId} className="text-xs font-normal">
            Create more
          </Label>
        </div>
        {props.onCancel ? (
          <Button variant="ghost" disabled={props.pending} onClick={props.onCancel}>
            Cancel
          </Button>
        ) : null}
        <form.SubmitButton pendingLabel="Creating…">Create {noun.lower}</form.SubmitButton>
      </div>
    </Form.Root>
  )
}
