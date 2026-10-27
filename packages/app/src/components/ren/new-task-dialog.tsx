import { useEffect, useState, type ReactElement, type ReactNode } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
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
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  PriorityIcon,
  StatusGlyph,
  priorityLabelOf,
  statusOf,
  labelColor,
  priorities,
  statuses,
} from "@/components/ren/task-meta"
import { Spinner } from "@/components/ui/spinner"
import { useAgents } from "@/hooks/use-agents"
import { useLabels } from "@/hooks/use-labels"
import { useSpaces } from "@/hooks/use-spaces"
import { api, errorMessage } from "@/lib/api"
import { closeNewTask, openNewTask, useNewTask } from "@/stores/ui"

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
            size="xs"
            aria-label={props.label}
            className={`h-7 rounded-full px-3 ${props.muted ? "" : "text-foreground"}`}
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

export function useNewTaskShortcut() {
  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "c" || !isBareKey(event) || isTyping(event.target)) return
      event.preventDefault()
      openNewTask()
    }
    window.addEventListener("keydown", open)
    return () => window.removeEventListener("keydown", open)
  }, [])
}

export function NewTaskDialog(props: {
  trigger?: ReactElement | undefined
  children?: ReactNode
  spaceId?: string | undefined
}) {
  const requested = useNewTask()
  const global = props.trigger === undefined
  const [ownOpen, setOwnOpen] = useState(false)
  const open = global ? requested !== null : ownOpen
  const setOpen = (next: boolean) => {
    if (global) {
      if (!next) closeNewTask()
    } else setOwnOpen(next)
  }
  const spaces = useSpaces()
  const agents = useAgents().agents
  const labels = useLabels()
  const defaultSpace = props.spaceId ?? requested?.spaceId ?? spaces.joined.at(0)?.id ?? ""
  const [expanded, setExpanded] = useState(false)
  const [createMore, setCreateMore] = useState(false)
  const [draft, setDraft] = useState(() => draftFor(defaultSpace))
  const spaceId = draft.spaceId || defaultSpace
  const spaceName = spaces.spaceName
  const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }))
  const mutation = useMutation(api.task.create.mutationOptions())
  const create = () => {
    mutation.mutate(
      {
        spaceId,
        title: draft.title.trim(),
        ...(draft.description.trim() && { description: draft.description.trim() }),
        status:
          draft.status === "in_progress"
            ? "in_progress"
            : draft.status === "done"
              ? "done"
              : draft.status === "dismissed"
                ? "dismissed"
                : "todo",
        ...(draft.priority === "high" || draft.priority === "medium" || draft.priority === "low"
          ? { priority: draft.priority }
          : {}),
        ...(draft.agentId !== "none" && { agentId: draft.agentId }),
        ...(draft.labels.length > 0 && { labels: draft.labels }),
      },
      {
        onSuccess: (task) => {
          toast.success(`${task.identifier} created`)
          setDraft(draftFor(spaceId))
          if (!createMore) setOpen(false)
        },
        onError: (error) => toast.error("Could not create the task", { description: errorMessage(error) }),
      },
    )
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {props.trigger ? <DialogTrigger render={props.trigger}>{props.children}</DialogTrigger> : null}
      <DialogContent
        showCloseButton={false}
        className={`top-[12%] translate-y-0 gap-0 p-0 ${expanded ? "sm:max-w-5xl" : "sm:max-w-3xl"}`}
      >
        <div className="flex items-center gap-2 p-4 pb-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="xs"
                  className="h-7 rounded-full px-3 font-normal text-foreground"
                  aria-label={`Space: ${spaceName(spaceId)}`}
                />
              }
            >
              <IconCube />
              {spaceName(spaceId)}
              <IconChevronDown className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuRadioGroup value={spaceId} onValueChange={(next: string) => set({ spaceId: next })}>
                {spaces.joined.map((space) => (
                  <DropdownMenuRadioItem key={space.id} value={space.id}>
                    <IconCube />
                    {space.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
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
              className={`resize-none rounded-none border-0 p-0 text-base focus-visible:ring-0 md:text-base ${expanded ? "min-h-80" : "min-h-20"}`}
            />
          </div>
          <div className="flex flex-wrap gap-2 px-4 pt-4 pb-2">
            <Chip
              label="Status"
              value={draft.status}
              options={Object.entries(statuses).map(([value, status]) => ({
                value,
                label: status.label,
              }))}
              icon={<StatusGlyph status={draft.status} />}
              text={statusOf(draft.status).label}
              onChange={(status) => set({ status })}
            />
            <Chip
              label="Priority"
              value={draft.priority}
              options={[
                { value: "none", label: "No priority" },
                ...Object.entries(priorities).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
              icon={<PriorityIcon priority={draft.priority === "none" ? null : draft.priority} />}
              text={draft.priority === "none" ? "Priority" : priorityLabelOf(draft.priority)}
              muted={draft.priority === "none"}
              onChange={(priority) => set({ priority })}
            />
            <Chip
              label="Assignee"
              value={draft.agentId}
              options={[
                { value: "none", label: "No assignee" },
                ...agents.map((agent) => ({
                  value: agent.id,
                  label: agent.name,
                })),
              ]}
              icon={draft.agentId === "none" ? <IconUserCircle /> : <IconGhost />}
              text={agents.find((agent) => agent.id === draft.agentId)?.name ?? "Assignee"}
              muted={draft.agentId === "none"}
              onChange={(agentId) => set({ agentId })}
            />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="xs"
                    aria-label="Labels"
                    className={`h-7 rounded-full px-3 ${draft.labels.length === 0 ? "" : "text-foreground"}`}
                  />
                }
              >
                <IconTag />
                {draft.labels.length === 0 ? "Labels" : draft.labels.join(", ")}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                {labels.map((label) => (
                  <DropdownMenuCheckboxItem
                    key={label.id}
                    checked={draft.labels.includes(label.name)}
                    onCheckedChange={(checked) =>
                      set({
                        labels: checked
                          ? [...draft.labels, label.name]
                          : draft.labels.filter((name) => name !== label.name),
                      })
                    }
                  >
                    <span className="size-2 rounded-full" style={{ background: labelColor(label.color) }} />
                    {label.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
