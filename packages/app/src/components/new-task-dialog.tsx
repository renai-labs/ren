import { Tasks } from "@ren/client/react"
import { Breadcrumb } from "./breadcrumb.js"
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react"
import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import {
  IconCalendarDue,
  IconChevronDown,
  IconCube,
  IconMaximize,
  IconMinimize,
  IconTag,
  IconX,
} from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { cn } from "cn"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@ren/ui/dialog"
import { Switch } from "@ren/ui/switch"
import { useHeldFiles } from "../lib/task-files.js"
import { MarkdownEditor } from "./markdown-editor.js"
import { Textarea } from "@ren/ui/textarea"
import { formatDate } from "@ren/ui/time"
import { PriorityIcon, StatusGlyph, UnassignedIcon, priorityLabelOf, statusOf } from "./task-meta.js"
import { PriorityMenu, StatusMenu } from "./task-pickers.js"
import { Spinner } from "@ren/ui/spinner"
import { useSpaces } from "../lib/use-spaces.js"
import { errorMessage } from "../lib/errors.js"
import { RouterContext } from "../lib/router-context.js"
import { Keyboard } from "../platform/keyboard.js"
import { TaskAgentPicker, TaskPersonPicker } from "./assignee-picker.js"
import { PersonAvatar } from "./person-avatar.js"
import { useMembers } from "../lib/use-members.js"
import { LabelPicker } from "./label-picker.js"
import { DueDatePicker } from "./due-date-picker.js"
import { SpacePicker } from "./space-picker.js"
import { useAgents } from "../lib/use-agents.js"
import { IconAgent } from "../icons/heroicons.js"

const isBareKey = (event: KeyboardEvent) =>
  !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.repeat && !event.isComposing

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.closest("input, textarea, select, [role=dialog], [role=menu]") !== null)

export function useNewTaskShortcut(onOpen: () => void) {
  Keyboard.useKeyDown((event) => {
    if (event.defaultPrevented || event.key.toLowerCase() !== "c" || !isBareKey(event) || isTyping(event.target)) return
    event.preventDefault()
    onOpen()
  })
}

function SpaceChip(props: { spaceId: string; onChange: (spaceId: string) => void }) {
  const spaces = useSpaces()
  return (
    <SpacePicker
      value={props.spaceId}
      heading="Create in a space"
      onChange={props.onChange}
      trigger={
        <Button
          variant="outline"
          size="sm"
          className="rounded-full px-3 font-normal text-foreground"
          aria-label={`Space: ${spaces.spaceName(props.spaceId)}`}
        />
      }
    >
      <IconCube />
      {spaces.spaceName(props.spaceId)}
      <IconChevronDown className="text-muted-foreground" />
    </SpacePicker>
  )
}

function LabelsChip(props: { value: ReadonlyArray<string>; spaceId: string; onChange: (labels: string[]) => void }) {
  return (
    <LabelPicker
      value={props.value}
      spaceId={props.spaceId}
      onChange={props.onChange}
      trigger={
        <Button
          variant="outline"
          size="sm"
          aria-label={props.value.length === 0 ? "Labels" : `Labels: ${props.value.join(", ")}`}
          className={cn("rounded-full px-3", props.value.length > 0 && "text-foreground")}
        />
      }
    >
      <IconTag />
      {props.value.length === 0 ? "Labels" : props.value.join(", ")}
    </LabelPicker>
  )
}

function AgentChip(props: { draft: Tasks.Draft; spaceId: string; onChange: (patch: Partial<Tasks.Draft>) => void }) {
  const agentId = props.draft.agentId === "none" ? null : props.draft.agentId
  const name = useAgents().agent(agentId)?.name
  return (
    <TaskAgentPicker
      value={agentId}
      spaceId={props.spaceId}
      onChange={(next) => props.onChange({ agentId: next ?? "none" })}
      trigger={
        <Button
          variant="outline"
          size="sm"
          aria-label={name ? `Agent: ${name}` : "Agent"}
          className={cn("rounded-full px-3", name && "text-foreground")}
        />
      }
    >
      <IconAgent />
      {name ?? "Agent"}
    </TaskAgentPicker>
  )
}

function PersonChip(props: { draft: Tasks.Draft; onChange: (patch: Partial<Tasks.Draft>) => void }) {
  const ownerId = props.draft.ownerId === "none" ? null : props.draft.ownerId
  const owner = useMembers().member(ownerId)
  return (
    <TaskPersonPicker
      value={ownerId}
      onChange={(next) => props.onChange({ ownerId: next ?? "none" })}
      trigger={
        <Button
          variant="outline"
          size="sm"
          aria-label={owner ? `Assignee: ${owner.name}` : "Assignee"}
          className={cn("rounded-full px-3", owner && "text-foreground")}
        />
      }
    >
      {owner ? <PersonAvatar name={owner.name} image={owner.image} /> : <UnassignedIcon />}
      {owner?.name ?? "Assignee"}
    </TaskPersonPicker>
  )
}

function TaskChips(props: {
  draft: Tasks.Draft
  spaceId: string
  className?: string
  onChange: (patch: Partial<Tasks.Draft>) => void
}) {
  const noPriority = props.draft.priority === "none"
  return (
    <div className={cn("flex flex-wrap gap-2 px-4 pt-4 pb-2", props.className)}>
      <StatusMenu
        status={props.draft.status}
        onChange={(status) => props.onChange({ status })}
        trigger={
          <Button
            variant="outline"
            size="sm"
            aria-label={`Status: ${statusOf(props.draft.status).label}`}
            className="rounded-full px-3 text-foreground"
          />
        }
      >
        <StatusGlyph status={props.draft.status} />
        {statusOf(props.draft.status).label}
      </StatusMenu>
      <PriorityMenu
        priority={props.draft.priority}
        onChange={(priority) => props.onChange({ priority: priority ?? "none" })}
        trigger={
          <Button
            variant="outline"
            size="sm"
            aria-label={noPriority ? "Priority" : `Priority: ${priorityLabelOf(props.draft.priority)}`}
            className={cn("rounded-full px-3", !noPriority && "text-foreground")}
          />
        }
      >
        <PriorityIcon priority={noPriority ? null : props.draft.priority} />
        {noPriority ? "Priority" : priorityLabelOf(props.draft.priority)}
      </PriorityMenu>
      <AgentChip draft={props.draft} spaceId={props.spaceId} onChange={props.onChange} />
      <PersonChip draft={props.draft} onChange={props.onChange} />
      <LabelsChip
        value={props.draft.labels}
        spaceId={props.spaceId}
        onChange={(next) => props.onChange({ labels: next })}
      />
      <DueChip value={props.draft.dueAt} onChange={(dueAt) => props.onChange({ dueAt })} />
    </div>
  )
}

function DueChip(props: { value: string; onChange: (value: string) => void }) {
  return (
    <DueDatePicker
      value={props.value || null}
      onChange={(value) => props.onChange(value ?? "")}
      trigger={
        <Button
          variant="outline"
          size="sm"
          aria-label={props.value ? `Due date: ${formatDate(props.value)}` : "Due date"}
          className={cn("rounded-full px-3", props.value && "text-foreground")}
        />
      }
    >
      <IconCalendarDue />
      {props.value ? formatDate(props.value) : "Due date"}
    </DueDatePicker>
  )
}

const fallbackSpace = (spaceId: string | undefined, joined: ReadonlyArray<{ readonly id: string }>) =>
  spaceId ?? joined.at(0)?.id ?? ""

function useOpen(controlled: { open?: boolean | undefined; onOpenChange?: ((open: boolean) => void) | undefined }) {
  const [own, setOwn] = useState(false)
  return [controlled.open ?? own, controlled.onOpenChange ?? setOwn] as const
}

function TitleField({
  ref,
  ...props
}: {
  ref: Ref<HTMLTextAreaElement>
  value: string
  missing: boolean
  className?: string
  onChange: (title: string) => void
}) {
  const errorId = useId()
  return (
    <>
      <Textarea
        ref={ref}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder="Task title"
        aria-label="Task title"
        aria-invalid={props.missing || undefined}
        aria-describedby={props.missing ? errorId : undefined}
        rows={1}
        className={cn(
          "min-h-7 resize-none rounded-none border-0 bg-transparent p-0 text-xl font-medium wrap-break-word shadow-none focus-visible:ring-0 md:text-xl dark:bg-transparent",
          props.className,
        )}
      />
      {props.missing ? (
        <p id={errorId} className="text-xs text-destructive">
          Give the task a title.
        </p>
      ) : null}
    </>
  )
}

const submitShortcut = (event: ReactKeyboardEvent<HTMLFormElement>) => {
  if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || event.nativeEvent.isComposing) return
  event.preventDefault()
  event.stopPropagation()
  event.currentTarget.requestSubmit()
}

function useTaskForm(spaceId: string, parentId: string | undefined, titleRef: RefObject<HTMLTextAreaElement | null>) {
  const { api } = RouterContext.useRouterContext()
  const held = useHeldFiles()
  const mutation = useMutation(api.task.create.mutationOptions())
  const [draft, setDraft] = useState(() => Tasks.draft(spaceId))
  const [missing, setMissing] = useState(false)
  const set = (patch: Partial<Tasks.Draft>) => setDraft((current) => ({ ...current, ...patch }))
  return {
    draft,
    set,
    held,
    missing,
    pending: mutation.isPending,
    reset: (next: string) => setDraft(Tasks.draft(next)),
    setTitle: (title: string) => {
      set({ title })
      setMissing(false)
    },
    submit: (event: FormEvent<HTMLFormElement>, target: string, onCreated: () => void) => {
      event.preventDefault()
      if (!draft.title.trim()) {
        setMissing(true)
        titleRef.current?.focus()
        return
      }
      const description = draft.description
      mutation.mutate(Tasks.createInput({ ...draft, description: held.without(description) }, target, parentId), {
        onSuccess: (task) => {
          toast.success(`${task.identifier} created`)
          held.attach(task, description)
          onCreated()
        },
        onError: (error) =>
          toast.error(`Could not create the ${parentId ? "sub-task" : "task"}`, { description: errorMessage(error) }),
      })
    },
  }
}

export function NewTaskDialog(props: {
  trigger?: ReactElement | undefined
  children?: ReactNode
  spaceId?: string | undefined
  parent?: { id: string; identifier: string } | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}) {
  const [open, setOpen] = useOpen(props)
  const spaces = useSpaces()
  const defaultSpace = fallbackSpace(props.spaceId, spaces.joined)
  const [expanded, setExpanded] = useState(false)
  const [createMore, setCreateMore] = useState(false)
  const [created, setCreated] = useState(0)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const form = useTaskForm(defaultSpace, props.parent?.id, titleRef)
  const draft = form.draft
  const set = form.set
  const spaceId = draft.spaceId || defaultSpace
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {props.trigger ? <DialogTrigger render={props.trigger}>{props.children}</DialogTrigger> : null}
      <DialogContent
        showCloseButton={false}
        initialFocus={titleRef}
        className={cn("top-[12%] translate-y-0 gap-0 p-0", expanded ? "sm:max-w-5xl" : "sm:max-w-3xl")}
      >
        <div className="flex items-center gap-2 p-4 pb-2">
          <Breadcrumb.Root
            ancestors={[
              {
                key: "parent",
                content: props.parent ? (
                  props.parent.identifier
                ) : (
                  <SpaceChip spaceId={spaceId} onChange={(next) => set({ spaceId: next, agentId: "none" })} />
                ),
              },
            ]}
          >
            <DialogTitle>{props.parent ? "New sub-task" : "New task"}</DialogTitle>
          </Breadcrumb.Root>
          <DialogDescription className="sr-only">Give the task a title, then set its properties.</DialogDescription>
          <Button
            variant="ghost"
            size="icon-sm"
            className="-mr-1 ml-auto text-muted-foreground"
            aria-label={expanded ? "Collapse task composer" : "Expand task composer"}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <IconMinimize /> : <IconMaximize />}
          </Button>
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label="Close task composer"
              />
            }
          >
            <IconX />
          </DialogClose>
        </div>
        <form
          className="flex min-w-0 flex-col"
          onKeyDownCapture={submitShortcut}
          onSubmit={(event) =>
            form.submit(event, spaceId, () => {
              form.reset(spaceId)
              setCreated((count) => count + 1)
              if (!createMore) setOpen(false)
            })
          }
        >
          <div className="flex flex-col gap-2 px-6 pt-2">
            <TitleField ref={titleRef} value={draft.title} missing={form.missing} onChange={form.setTitle} />
            <MarkdownEditor
              key={created}
              value={draft.description}
              label="Task description"
              placeholder="Add description…"
              media={form.held.hold}
              onChange={(description) => set({ description })}
              className={expanded ? "[&_.tiptap]:min-h-80" : "[&_.tiptap]:min-h-20"}
            />
          </div>
          <TaskChips draft={draft} spaceId={spaceId} onChange={set} />
          <div className="flex items-center justify-end gap-4 px-4 pt-2 pb-4">
            {/* oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the label wraps a Base UI Switch, which renders a button */}
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={createMore} onCheckedChange={setCreateMore} />
              Create more
            </label>
            <Button type="submit" disabled={!spaceId || form.pending}>
              {form.pending ? <Spinner data-icon="inline-start" /> : null}
              Create task
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SubtaskComposer(props: {
  parent: { id: string; identifier: string }
  spaceId: string
  onClose: () => void
}) {
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const form = useTaskForm(props.spaceId, props.parent.id, titleRef)
  useEffect(() => titleRef.current?.focus(), [titleRef])
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape closes the inline form, as it closes a dialog
    <form
      aria-label={`New sub-task of ${props.parent.identifier}`}
      className="mt-2 flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3"
      onKeyDownCapture={submitShortcut}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
        event.preventDefault()
        props.onClose()
      }}
      onSubmit={(event) => form.submit(event, props.spaceId, props.onClose)}
    >
      <TitleField
        ref={titleRef}
        value={form.draft.title}
        missing={form.missing}
        className="min-h-6 text-sm md:text-sm"
        onChange={form.setTitle}
      />
      <MarkdownEditor
        value={form.draft.description}
        label="Sub-task description"
        placeholder="Add description…"
        media={form.held.hold}
        className="[&_.tiptap]:min-h-6"
        onChange={(description) => form.set({ description })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <TaskChips draft={form.draft} spaceId={props.spaceId} className="p-0" onChange={form.set} />
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={form.pending}>
            {form.pending ? <Spinner data-icon="inline-start" /> : null}
            Create
          </Button>
        </div>
      </div>
    </form>
  )
}
