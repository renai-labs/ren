import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import {
  IconAlertCircle,
  IconCalendar,
  IconChevronRight,
  IconCube,
  IconDots,
  IconHistory,
  IconLink,
  IconMessage,
  IconPlayerPlay,
  IconPlus,
  IconGhost,
  IconSquare,
  IconSquareCheckFilled,
  IconUserCircle,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/ren/confirm-dialog"
import { PersonAvatar } from "@/components/ren/person-avatar"
import {
  LabelBadge,
  PriorityIcon,
  StatusIcon,
  labelColor,
  priorities,
  priorityLabelOf,
  statusOf,
  statuses,
} from "@/components/ren/task-meta"
import { formatDate } from "@/lib/format"
import { SessionThread } from "@/routes/chat/chat"
import { useTaskPage } from "@/routes/task/use-task-page"

const propertyButton =
  "-ml-2 h-8 w-fit justify-start gap-2 px-2 font-normal [&_svg:not([class*='text-'])]:text-muted-foreground"

const pickerCommand =
  "rounded-none! **:data-[slot=input-group]:h-14! **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:text-[11px] **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:uppercase"
const pickerItem = "h-11 gap-3 rounded-lg px-3"

function PropertySection(props: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h2 className="mb-1 text-sm text-muted-foreground">{props.title}</h2>
      {props.children}
    </section>
  )
}

export function TaskPage() {
  const page = useTaskPage()
  const task = page.task
  const set = page.set
  const subtasks = page.subtasks
  const owner = page.owner?.name
  const assignee = page.assignee
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="mx-8 flex h-11.5 shrink-0 items-center gap-2 border-b text-sm">
        <Link to="/tasks" className="font-medium">
          Tasks
        </Link>
        <IconChevronRight className="size-4 text-muted-foreground" />
        <span className="font-mono text-xs text-muted-foreground">
          {task.identifier}
        </span>
        <span className="truncate font-medium">{task.title}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="sm"
                className="ml-auto"
                aria-label={`Start a session for ${task.title}`}
              />
            }
          >
            <IconPlayerPlay />
            Start
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuGroup>
            <DropdownMenuItem disabled={page.starting} onClick={() => page.start("new")}>
              <IconPlus />
              Start new session
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!task.session || page.starting}
              onClick={() => page.start("continue")}
            >
              <IconHistory />
              Continue last session
            </DropdownMenuItem>
            {task.session ? (
              <DropdownMenuItem onClick={() => page.openSession(task.session?.id)}>
                <IconMessage />
                Open session
              </DropdownMenuItem>
            ) : null}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label={`Actions for ${task.title}`}
              />
            }
          >
            <IconDots />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => set({ status: "done" })}>
              Mark done
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => set({ status: "dismissed" })}>
              Dismiss
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={task.agentId === null}
              onClick={() => page.assignTo({ agentId: null })}
            >
              Unassign
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={task.humanReview}
              onClick={page.requestReview}
            >
              Request review
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => page.setArchiving(true)}
            >
              Archive task
            </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div className="flex min-h-0 flex-1 gap-8 overflow-y-auto overscroll-contain pr-8 pl-2">
        <article className="mx-auto flex w-full max-w-200 min-w-0 flex-col gap-6 pt-12 pb-16">
          <h1 className="text-[28px]/9 font-semibold tracking-tight">
            {task.title}
          </h1>
          {task.humanReview ? (
            <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
              <IconAlertCircle className="mt-0.5 size-4 text-chart-3" />
              <div className="flex flex-1 flex-col gap-1">
                <span className="text-sm font-medium">Needs your review</span>
                {task.humanReviewReason ? (
                  <span className="text-sm text-muted-foreground">
                    {task.humanReviewReason}
                  </span>
                ) : null}
              </div>
              <Button variant="ghost" size="sm" onClick={() => page.decide("changes_requested")}>
                Request changes
              </Button>
              <Button size="sm" onClick={() => page.decide("approved")}>
                Approve
              </Button>
            </div>
          ) : null}
          <Textarea
            key={task.updatedAt}
            defaultValue={task.description ?? ""}
            onBlur={(event) => {
              const description = event.currentTarget.value.trim()
              if (description !== (task.description ?? "")) set({ description: description || null })
            }}
            placeholder="Add description…"
            aria-label="Task description"
            className="min-h-24 resize-none rounded-none border-0 p-0 text-base focus-visible:ring-0 md:text-base"
          />
          {subtasks.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">
                Subtasks · {task.subtasks?.done ?? 0} of{" "}
                {task.subtasks?.total ?? subtasks.length} done
              </h2>
              {subtasks.map((subtask) => (
                <Link
                  key={subtask.id}
                  to="/tasks/$taskId"
                  params={{ taskId: subtask.id }}
                  className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm hover:bg-muted"
                >
                  <StatusIcon task={subtask} />
                  <span className="font-mono text-xs text-muted-foreground">
                    {subtask.identifier}
                  </span>
                  {subtask.title}
                </Link>
              ))}
            </section>
          ) : null}
          {task.links.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Links</h2>
              {task.links.map((link) => (
                <a
                  key={link.id}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-sm text-ring"
                >
                  <IconLink className="size-4" />
                  {link.url}
                </a>
              ))}
            </section>
          ) : null}
          <Separator />
          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-medium">Activity</h2>
            {page.activity.map((comment) => (
              <div key={comment.id} className="flex gap-3 text-sm">
                <PersonAvatar name={page.authorName(comment.author)} />
                <div className="flex flex-col gap-1">
                  <span>
                    <span className="font-medium">{page.authorName(comment.author)}</span>{" "}
                    <span className="text-muted-foreground">
                      · {formatDate(comment.createdAt)}
                    </span>
                  </span>
                  <span className="whitespace-pre-wrap">{comment.body}</span>
                </div>
              </div>
            ))}
            <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
              <Textarea
                placeholder="Leave a comment…"
                aria-label="Comment"
                value={page.comment}
                onChange={(event) => page.setComment(event.currentTarget.value)}
                className="min-h-12 resize-none border-0 p-0 focus-visible:ring-0"
              />
              <Button
                size="sm"
                className="self-end"
                disabled={page.commenting || !page.comment.trim()}
                onClick={page.sendComment}
              >
                Comment
              </Button>
            </div>
          </section>
        </article>
        <aside
          aria-label="Task properties"
          className="flex w-70 shrink-0 flex-col gap-6 pt-12"
        >
          <PropertySection title="Properties">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    className={propertyButton}
                    aria-label={`Status for ${task.title}`}
                  />
                }
              >
                <StatusIcon task={task} />
                {statusOf(task.status).label}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                <DropdownMenuRadioGroup
                  value={task.status}
                  onValueChange={(status: string) => {
                    if (status === "todo" || status === "in_progress" || status === "done" || status === "dismissed")
                      set({ status })
                  }}
                >
                  {Object.entries(statuses).map((entry) => (
                    <DropdownMenuRadioItem key={entry[0]} value={entry[0]}>
                      {entry[1].label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    className={propertyButton}
                    aria-label={`Priority for ${task.title}`}
                  />
                }
              >
                <PriorityIcon priority={task.priority} />
                {task.priority
                  ? priorityLabelOf(task.priority)
                  : "No priority"}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                <DropdownMenuRadioGroup
                  value={task.priority ?? "none"}
                  onValueChange={(priority: string) =>
                    set({
                      priority: priority === "high" || priority === "medium" || priority === "low" ? priority : null,
                    })
                  }
                >
                  {[["none", "No priority"], ...Object.entries(priorities)].map(
                    (entry) => (
                      <DropdownMenuRadioItem key={entry[0]} value={entry[0]}>
                        {entry[1]}
                      </DropdownMenuRadioItem>
                    )
                  )}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    className={`${propertyButton} ${assignee ? "" : "text-muted-foreground"}`}
                    aria-label={`Assignee for ${task.title}`}
                  />
                }
              >
                {task.agentId ? (
                  <IconGhost />
                ) : owner ? (
                  <PersonAvatar name={owner} image={page.owner?.image} />
                ) : (
                  <IconUserCircle />
                )}
                {assignee ?? "Unassigned"}
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 gap-0 p-0">
                <Command className={pickerCommand}>
                  <CommandInput
                    placeholder="Search assignee…"
                    className="text-base"
                  />
                  <CommandList className="max-h-80 p-1">
                    <CommandEmpty>No one matches.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        className={pickerItem}
                        data-checked={assignee === null}
                        onSelect={() => page.assignTo({ agentId: null, ownerId: null })}
                      >
                        <IconUserCircle />
                        Unassigned
                      </CommandItem>
                    </CommandGroup>
                    <CommandGroup heading="Assign to an agent">
                      {page.agents.map((agent) => (
                        <CommandItem
                          key={agent.id}
                          className={pickerItem}
                          data-checked={task.agentId === agent.id}
                          onSelect={() => page.assignTo({ agentId: agent.id })}
                        >
                          <IconGhost />
                          {agent.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    <CommandGroup heading="Assign to a person">
                      {page.members.map((member) => (
                        <CommandItem
                          key={member.id}
                          className={pickerItem}
                          data-checked={
                            task.agentId === null && task.ownerId === member.id
                          }
                          onSelect={() =>
                            page.assignTo({ agentId: null, ownerId: member.id })
                          }
                        >
                          <PersonAvatar name={member.name} image={member.image} />
                          {member.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    className={`${propertyButton} ${task.dueAt ? "" : "text-muted-foreground"}`}
                    aria-label={`Due date for ${task.title}`}
                  />
                }
              >
                <IconCalendar />
                {task.dueAt ? formatDate(task.dueAt) : "Set due date"}
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 gap-2 p-3">
                <Calendar
                  mode="single"
                  selected={task.dueAt ? new Date(task.dueAt) : undefined}
                  onSelect={(day: Date | undefined) =>
                    set({ dueAt: day ? day.toISOString() : null })
                  }
                  className="w-full p-0"
                />
                <Separator />
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-6.5 self-start"
                  onClick={() => set({ dueAt: new Date().toISOString() })}
                >
                  Today
                </Button>
              </PopoverContent>
            </Popover>
          </PropertySection>
          <PropertySection title="Labels">
            <div className="flex flex-wrap items-center gap-1.5">
              {task.labels.map((label) => (
                <LabelBadge key={label.id} name={label.name} color={label.color} />
              ))}
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground"
                      aria-label={`Labels for ${task.title}`}
                    />
                  }
                >
                  <IconPlus />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 gap-0 p-1">
                  <Command>
                    <CommandInput placeholder="Search or create labels…" />
                    <CommandList className="pt-1">
                      <CommandEmpty>No labels match.</CommandEmpty>
                      {page.labels.map((label) => {
                        const names = task.labels.map((each) => each.name)
                        const checked = names.includes(label.name)
                        return (
                          <CommandItem
                            key={label.id}
                            data-checked={checked}
                            onSelect={() =>
                              set({
                                labels: checked
                                  ? names.filter((name) => name !== label.name)
                                  : [...names, label.name],
                              })
                            }
                          >
                            {checked ? (
                              <IconSquareCheckFilled />
                            ) : (
                              <IconSquare className="text-muted-foreground" />
                            )}
                            <span
                              className="size-2 rounded-full"
                              style={{ background: labelColor(label.color) }}
                            />
                            {label.name}
                          </CommandItem>
                        )
                      })}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </PropertySection>
          <PropertySection title="Space">
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    className={`${propertyButton} font-medium`}
                    aria-label={`Space for ${task.title}`}
                  />
                }
              >
                <IconCube />
                {page.spaceName}
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 gap-0 p-0">
                <Command className={pickerCommand}>
                  <CommandInput
                    placeholder="Search space…"
                    className="text-base"
                  />
                  <p className="-mx-1 border-b px-4 py-2 text-xs text-muted-foreground">
                    Moving a task does not start work.
                  </p>
                  <CommandList className="max-h-80 p-1">
                    <CommandEmpty>No spaces match.</CommandEmpty>
                    <CommandGroup heading="Move to a space">
                      {page.spaces.map((space) => (
                        <CommandItem
                          key={space.id}
                          className={pickerItem}
                          data-checked={task.spaceId === space.id}
                          onSelect={() => page.assignTo({ spaceId: space.id })}
                        >
                          <IconCube />
                          {space.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </PropertySection>
        </aside>
      </div>
      <ConfirmDialog
        open={page.archiving}
        onOpenChange={page.setArchiving}
        confirmation={{
          title: "Archive this task?",
          description: "It leaves the task list. Its chats stay.",
          action: "Archive",
        }}
        onConfirm={page.archive}
      />
      <Sheet
        open={page.session !== undefined}
        onOpenChange={(open) => (open ? undefined : page.openSession(undefined))}
      >
        <SheetContent className="data-[side=right]:sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>Task session</SheetTitle>
            <SheetDescription>
              Chat with the agent working on this task.
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col">
            {page.session ? <SessionThread sessionId={page.session} /> : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
