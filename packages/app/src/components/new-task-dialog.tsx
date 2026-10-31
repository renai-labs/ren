import type { TaskCreateInput } from "@ren/client"
import { useState, type ReactElement, type ReactNode } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "@ren/ui/sonner"
import {
  IconMaximize,
  IconMinimize,
  IconChevronDown,
  IconChevronRight,
  IconCube,
  IconGhost,
  IconTag,
  IconUserCircle,
  IconX,
} from "@tabler/icons-react"
import { Button } from "@ren/ui/button"
import { cn } from "cn"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@ren/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Switch } from "@ren/ui/switch"
import { Textarea } from "@ren/ui/textarea"
import { PriorityIcon, StatusGlyph, priorityLabelOf, statusOf, labelColor, priorities, statuses } from "./task-meta.js"
import { Spinner } from "@ren/ui/spinner"
import { useAgents } from "../lib/use-agents.js"
import { useLabels } from "../lib/use-labels.js"
import { useSpaces } from "../lib/use-spaces.js"
import { errorMessage } from "../lib/errors.js"
import { ColorDot } from "@ren/ui/color-dot"
import { RouterContext } from "../lib/router-context.js"
import { Keyboard } from "../platform/keyboard.js"

function Chip(props: {
  label: string
  value: string
  options: { value: string; label: string }[]
  icon: ReactElement
  text: string
  muted?: boolean
  onChange: (value: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={props.label}
            className={cn("rounded-full px-3", !props.muted && "text-foreground")}
          />
        }
      >
        {props.icon}
        {props.text}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuRadioGroup value={props.value} onValueChange={props.onChange}>
          {props.options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const draftFor = (spaceId: string) => ({
  spaceId,
  title: "",
  description: "",
  status: "todo",
  priority: "none",
  agentId: "none",
  labels: [] as string[],
})

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

function createStatus(status: string): TaskCreateInput["status"] {
  if (status === "in_progress" || status === "done" || status === "dismissed") return status
  return "todo"
}

const createPriority = (priority: string): Pick<TaskCreateInput, "priority"> =>
  priority === "high" || priority === "medium" || priority === "low" ? { priority } : {}

const taskInput = (draft: ReturnType<typeof draftFor>, spaceId: string): TaskCreateInput => ({
  spaceId,
  title: draft.title.trim(),
  ...(draft.description.trim() && { description: draft.description.trim() }),
  status: createStatus(draft.status),
  ...createPriority(draft.priority),
  ...(draft.agentId !== "none" && { agentId: draft.agentId }),
  ...(draft.labels.length > 0 && { labels: draft.labels }),
})

function SpaceChip(props: { spaceId: string; onChange: (spaceId: string) => void }) {
  const spaces = useSpaces()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuRadioGroup value={props.spaceId} onValueChange={(next: string) => props.onChange(next)}>
          {spaces.joined.map((space) => (
            <DropdownMenuRadioItem key={space.id} value={space.id}>
              <IconCube />
              {space.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function LabelsChip(props: { value: ReadonlyArray<string>; onChange: (labels: string[]) => void }) {
  const labels = useLabels()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label="Labels"
            className={cn("rounded-full px-3", props.value.length > 0 && "text-foreground")}
          />
        }
      >
        <IconTag />
        {props.value.length === 0 ? "Labels" : props.value.join(", ")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {labels.map((label) => (
          <DropdownMenuCheckboxItem
            key={label.id}
            checked={props.value.includes(label.name)}
            onCheckedChange={(checked) =>
              props.onChange(checked ? [...props.value, label.name] : props.value.filter((name) => name !== label.name))
            }
          >
            <ColorDot color={labelColor(label.color)} />
            {label.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TaskChips(props: {
  draft: ReturnType<typeof draftFor>
  onChange: (patch: Partial<ReturnType<typeof draftFor>>) => void
}) {
  const agents = useAgents().agents
  return (
    <div className="flex flex-wrap gap-2 px-4 pt-4 pb-2">
      <Chip
        label="Status"
        value={props.draft.status}
        options={Object.entries(statuses).map(([value, status]) => ({
          value,
          label: status.label,
        }))}
        icon={<StatusGlyph status={props.draft.status} />}
        text={statusOf(props.draft.status).label}
        onChange={(status) => props.onChange({ status })}
      />
      <Chip
        label="Priority"
        value={props.draft.priority}
        options={[
          { value: "none", label: "No priority" },
          ...Object.entries(priorities).map(([value, label]) => ({
            value,
            label,
          })),
        ]}
        icon={<PriorityIcon priority={props.draft.priority === "none" ? null : props.draft.priority} />}
        text={props.draft.priority === "none" ? "Priority" : priorityLabelOf(props.draft.priority)}
        muted={props.draft.priority === "none"}
        onChange={(priority) => props.onChange({ priority })}
      />
      <Chip
        label="Assignee"
        value={props.draft.agentId}
        options={[
          { value: "none", label: "No assignee" },
          ...agents.map((agent) => ({
            value: agent.id,
            label: agent.name,
          })),
        ]}
        icon={props.draft.agentId === "none" ? <IconUserCircle /> : <IconGhost />}
        text={agents.find((agent) => agent.id === props.draft.agentId)?.name ?? "Assignee"}
        muted={props.draft.agentId === "none"}
        onChange={(agentId) => props.onChange({ agentId })}
      />
      <LabelsChip value={props.draft.labels} onChange={(next) => props.onChange({ labels: next })} />
    </div>
  )
}

const fallbackSpace = (spaceId: string | undefined, joined: ReadonlyArray<{ readonly id: string }>) =>
  spaceId ?? joined.at(0)?.id ?? ""

function useOpen(controlled: { open?: boolean | undefined; onOpenChange?: ((open: boolean) => void) | undefined }) {
  const [own, setOwn] = useState(false)
  return [controlled.open ?? own, controlled.onOpenChange ?? setOwn] as const
}

export function NewTaskDialog(props: {
  trigger?: ReactElement | undefined
  children?: ReactNode
  spaceId?: string | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}) {
  const { api } = RouterContext.useRouterContext()
  const [open, setOpen] = useOpen(props)
  const spaces = useSpaces()
  const defaultSpace = fallbackSpace(props.spaceId, spaces.joined)
  const [expanded, setExpanded] = useState(false)
  const [createMore, setCreateMore] = useState(false)
  const [draft, setDraft] = useState(() => draftFor(defaultSpace))
  const spaceId = draft.spaceId || defaultSpace
  const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }))
  const mutation = useMutation(api.task.create.mutationOptions())
  const create = () => {
    mutation.mutate(taskInput(draft, spaceId), {
      onSuccess: (task) => {
        toast.success(`${task.identifier} created`)
        setDraft(draftFor(spaceId))
        if (!createMore) setOpen(false)
      },
      onError: (error) => toast.error("Could not create the task", { description: errorMessage(error) }),
    })
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {props.trigger ? <DialogTrigger render={props.trigger}>{props.children}</DialogTrigger> : null}
      <DialogContent
        showCloseButton={false}
        className={cn("top-[12%] translate-y-0 gap-0 p-0", expanded ? "sm:max-w-5xl" : "sm:max-w-3xl")}
      >
        <div className="flex items-center gap-2 p-4 pb-2">
          <SpaceChip spaceId={spaceId} onChange={(next) => set({ spaceId: next })} />
          <IconChevronRight className="size-4 text-muted-foreground" />
          <DialogTitle>New task</DialogTitle>
          <DialogDescription className="sr-only">Add a task to a space.</DialogDescription>
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
          className="flex flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            if (draft.title.trim()) create()
          }}
        >
          <div className="flex flex-col gap-2 px-6 pt-2">
            <Textarea
              value={draft.title}
              onChange={(event) => set({ title: event.target.value })}
              placeholder="Task title"
              aria-label="Task title"
              rows={1}
              className="min-h-7 resize-none rounded-none border-0 p-0 text-xl font-medium focus-visible:ring-0 md:text-xl"
            />
            <Textarea
              value={draft.description}
              onChange={(event) => set({ description: event.target.value })}
              placeholder="Add description…"
              aria-label="Task description"
              className={cn(
                "resize-none rounded-none border-0 p-0 text-base focus-visible:ring-0 md:text-base",
                expanded ? "min-h-80" : "min-h-20",
              )}
            />
          </div>
          <TaskChips draft={draft} onChange={set} />
          <div className="flex items-center justify-end gap-4 px-4 pt-2 pb-4">
            {/* oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the label wraps a Base UI Switch, which renders a button */}
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={createMore} onCheckedChange={setCreateMore} />
              Create more
            </label>
            <Button type="submit" disabled={!draft.title.trim() || !spaceId || mutation.isPending}>
              {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
              Create task
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
