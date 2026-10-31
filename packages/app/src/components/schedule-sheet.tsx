import { useState } from "react"
import type { ScheduleInfo } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { IconCalendar, IconChevronDown } from "@tabler/icons-react"
import { Option } from "effect"
import { toast } from "@ren/ui/sonner"
import { Button } from "@ren/ui/button"
import { Calendar } from "@ren/ui/calendar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@ren/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Separator } from "@ren/ui/separator"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@ren/ui/sheet"
import { Spinner } from "@ren/ui/spinner"
import { Textarea } from "@ren/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@ren/ui/toggle-group"
import { MenuSearch } from "./menu-search.js"
import { useNow } from "../lib/use-now.js"
import { useSpaces } from "../lib/use-spaces.js"
import { errorMessage } from "../lib/errors.js"
import { pickerPageSize } from "../lib/pagination.js"
import { formatDate } from "@ren/ui/time"
import { cn } from "cn"
import {
  cadenceOf,
  type Cadence,
  dateKey,
  dateOfKey,
  describeCadence,
  formatRun,
  frequencyOptions,
  isFrequency,
  localTimeZone,
  monthDays,
  nameOf,
  preview,
  timeZones,
  weekdays,
  whenOf,
} from "../lib/schedules.js"
import { RouterContext } from "../lib/router-context.js"

const defaultAgent = "default"

interface ScheduleChat {
  readonly spaceId: string
  readonly sessionId: string
}

const fieldTrigger =
  "border-input bg-card text-foreground hover:bg-card hover:text-foreground aria-expanded:bg-card aria-expanded:text-foreground"

const agentOptionsOf = (
  agents: ReadonlyArray<{ readonly id: string; readonly name: string; readonly organizationId: string | null }> = [],
) => [
  { value: defaultAgent, label: "Space default" },
  ...agents.filter((agent) => agent.organizationId !== null).map((agent) => ({ value: agent.id, label: agent.name })),
]

const sendsToChat = (schedule: ScheduleInfo | undefined, chat: ScheduleChat | undefined) =>
  chat !== undefined || (schedule !== undefined && schedule.target !== "new-chat")

const createTarget = (chat: ScheduleChat | undefined, agentId: string | undefined) =>
  chat
    ? { target: { sessionId: chat.sessionId } }
    : { target: "new-chat" as const, ...(agentId !== undefined && { agentId }) }

function sheetCopy(schedule: ScheduleInfo | undefined, chat: ScheduleChat | undefined) {
  if (schedule) return { title: "Edit schedule", description: "Run an agent on a recurring schedule." }
  if (chat)
    return { title: "Schedule a message", description: "Ren sends this message to the chat at the time you set." }
  return { title: "New schedule", description: "Run an agent on a recurring schedule." }
}

export function ScheduleSheet(props: {
  open: boolean
  version: number
  schedule: ScheduleInfo | undefined
  spaceId?: string | undefined
  chat?: ScheduleChat | undefined
  onClose: () => void
}) {
  const copy = sheetCopy(props.schedule, props.chat)
  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{copy.title}</SheetTitle>
          <SheetDescription>{copy.description}</SheetDescription>
        </SheetHeader>
        <ScheduleForm
          key={props.version}
          schedule={props.schedule}
          spaceId={props.chat?.spaceId ?? props.spaceId}
          chat={props.chat}
          onClose={props.onClose}
        />
      </SheetContent>
    </Sheet>
  )
}

const initialForm = (schedule: ScheduleInfo | undefined, spaceId: string) => ({
  message: schedule?.message ?? "",
  spaceId: schedule?.spaceId ?? spaceId,
  agentId: schedule?.agentId ?? defaultAgent,
})

function ScheduleForm(props: {
  schedule: ScheduleInfo | undefined
  spaceId: string | undefined
  chat: ScheduleChat | undefined
  onClose: () => void
}) {
  const { api } = RouterContext.useRouterContext()
  const schedule = props.schedule
  const spaces = useSpaces()
  const initial = initialForm(schedule, props.spaceId ?? spaces.joined.at(0)?.id ?? "")
  const [message, setMessage] = useState(initial.message)
  const [spaceId, setSpaceId] = useState(initial.spaceId)
  const [agentId, setAgentId] = useState(initial.agentId)
  const [cadence, setCadence] = useState(() => cadenceOf(schedule?.when, localTimeZone()))
  const [error, setError] = useState("")
  const agents = useQuery({
    ...api.agent.list.queryOptions({ page: 1, pageSize: pickerPageSize, isSubagent: false, spaceId }),
    enabled: spaceId !== "",
  })
  const create = useMutation(api.schedule.create.mutationOptions())
  const update = useMutation(api.schedule.update.mutationOptions())
  const pending = create.isPending || update.isPending
  const set = (patch: Partial<Cadence>) => setCadence((previous) => ({ ...previous, ...patch }))
  const next = preview(cadence)
  const agentOptions = agentOptionsOf(agents.data?.items)
  const frequency = cadence.frequency
  const toChat = sendsToChat(schedule, props.chat)
  const save = () => {
    const when = whenOf(cadence)
    const problem = problemOf({ message, spaceId, when, cadence, next })
    setError(problem)
    if (problem || Option.isNone(when)) return
    const fields = { name: nameOf(message), message: message.trim(), when: when.value }
    const done = {
      onSuccess: () => {
        props.onClose()
        toast.success(schedule ? "Schedule saved" : "Schedule created")
      },
      onError: (failure: Error) =>
        toast.error(schedule ? "Could not save the schedule" : "Could not create the schedule", {
          description: errorMessage(failure),
        }),
    }
    const agent = agentId === defaultAgent ? undefined : agentId
    if (schedule) return update.mutate({ id: schedule.id, ...fields, ...(!toChat && { agentId: agent ?? null }) }, done)
    return create.mutate({ spaceId, ...fields, ...createTarget(props.chat, agent) }, done)
  }
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <FieldGroup className="flex-1 gap-6 overflow-y-auto overscroll-contain px-4 pb-4">
        <Field>
          <FieldLabel htmlFor="schedule-prompt">Prompt</FieldLabel>
          <Textarea
            id="schedule-prompt"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="What should the agent do?"
            className="max-h-60 min-h-24"
          />
        </Field>
        {toChat || schedule ? null : (
          <SpaceField
            spaces={spaces.joined}
            value={spaceId}
            onChange={(value) => {
              setSpaceId(value)
              setAgentId(defaultAgent)
            }}
          />
        )}
        <CadenceFields cadence={cadence} next={next} onChange={set} />
        {toChat ? null : <AgentField options={agentOptions} value={agentId} onChange={setAgentId} />}
        <TimeZoneField value={cadence.timeZone} onChange={(timeZone) => set({ timeZone })} />
        {frequency === "once" ? null : <UntilFields cadence={cadence} onChange={set} />}
        {error ? <FieldError>{error}</FieldError> : null}
      </FieldGroup>
      <SheetFooter>
        <SheetClose render={<Button variant="ghost" />}>Cancel</SheetClose>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Save
        </Button>
      </SheetFooter>
    </form>
  )
}

function problemOf(input: {
  message: string
  spaceId: string
  when: Option.Option<unknown>
  cadence: Cadence
  next: ReturnType<typeof preview>
}) {
  if (input.message.trim() === "") return "Write a prompt for the agent."
  if (input.spaceId === "") return "Choose a space."
  if (Option.isNone(input.when)) return input.cadence.frequency === "once" ? "Pick a date and a time." : "Pick a time."
  if (input.next.kind === "invalid") return 'Use a cron expression with five fields, for example "0 9 * * *".'
  return ""
}

function SpaceField(props: {
  spaces: ReadonlyArray<{ id: string; name: string }>
  value: string
  onChange: (spaceId: string) => void
}) {
  return (
    <Field>
      <FieldLabel>Space</FieldLabel>
      <Select
        items={props.spaces.map((space) => ({ value: space.id, label: space.name }))}
        value={props.value}
        onValueChange={(value) => props.onChange(String(value))}
      >
        <SelectTrigger aria-label="Space" className="w-full">
          <SelectValue placeholder="Choose a space" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {props.spaces.map((space) => (
              <SelectItem key={space.id} value={space.id}>
                {space.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

function CadenceFields(props: {
  cadence: Cadence
  next: ReturnType<typeof preview>
  onChange: (patch: Partial<Cadence>) => void
}) {
  const frequency = props.cadence.frequency
  const frequencies = frequencyOptions.filter((option) => option.value !== "once" || frequency === "once")
  const timed = frequency !== "hourly" && frequency !== "custom"
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field className={timed ? undefined : "col-span-2"}>
          <FieldLabel>Frequency</FieldLabel>
          <Select
            items={frequencies}
            value={props.cadence.frequency}
            onValueChange={(value) => {
              if (isFrequency(value)) props.onChange({ frequency: value })
            }}
          >
            <SelectTrigger aria-label="Frequency" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {frequencies.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        {timed ? (
          <Field>
            <FieldLabel htmlFor="schedule-time">Time</FieldLabel>
            <Input
              id="schedule-time"
              type="time"
              value={props.cadence.time}
              onChange={(event) => props.onChange({ time: event.target.value })}
            />
          </Field>
        ) : null}
      </div>
      {props.cadence.frequency === "weekly" ? (
        <ToggleGroup
          multiple
          variant="outline"
          spacing={1}
          aria-label="Days"
          className="w-full"
          value={props.cadence.weekday.split(",").filter(Boolean)}
          onValueChange={(values: string[]) =>
            props.onChange({
              weekday: weekdays
                .filter((day) => values.includes(day.value))
                .map((day) => day.value)
                .join(","),
            })
          }
        >
          {weekdays.map((day) => (
            <ToggleGroupItem
              key={day.value}
              value={day.value}
              aria-label={day.label}
              className="flex-1 text-muted-foreground aria-pressed:text-foreground"
            >
              {day.label.slice(0, 3)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : null}
      {props.cadence.frequency === "monthly" ? (
        <Select
          items={monthDays}
          value={props.cadence.monthDay}
          onValueChange={(value) => props.onChange({ monthDay: String(value) })}
        >
          <SelectTrigger aria-label="Day of month" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {monthDays.map((day) => (
                <SelectItem key={day.value} value={day.value}>
                  {day.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : null}
      {props.cadence.frequency === "once" ? (
        <DateField
          label="Date"
          placeholder="Pick a date"
          value={props.cadence.date}
          onChange={(date) => props.onChange({ date })}
        />
      ) : null}
      {props.cadence.frequency === "custom" ? (
        <Field>
          <Input
            aria-label="Cron expression"
            value={props.cadence.cron}
            onChange={(event) => props.onChange({ cron: event.target.value })}
            placeholder="0 9 * * 1-5"
            className="font-mono"
          />
          <FieldDescription className="text-xs">
            Five fields: minute, hour, day of month, month, day of week.
          </FieldDescription>
        </Field>
      ) : null}
      <p className="min-h-4 text-xs text-muted-foreground tabular-nums">
        {props.next.kind === "invalid"
          ? null
          : `${describeCadence(props.cadence)} · ${
              props.next.kind === "never" ? "No runs left" : `Next ${formatRun(props.next.at, props.cadence.timeZone)}`
            }`}
      </p>
    </div>
  )
}

function AgentField(props: {
  options: ReadonlyArray<{ value: string; label: string }>
  value: string
  onChange: (agentId: string) => void
}) {
  return (
    <Field>
      <FieldLabel>Agent</FieldLabel>
      <Select items={props.options} value={props.value} onValueChange={(value) => props.onChange(String(value))}>
        <SelectTrigger aria-label="Agent" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {props.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

function UntilFields(props: { cadence: Cadence; onChange: (patch: Partial<Cadence>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <DateField
        label="Until"
        placeholder="No end date"
        optional
        value={props.cadence.until}
        onChange={(until) => props.onChange({ until })}
      />
      <Field>
        <FieldLabel htmlFor="schedule-until-time">Until time</FieldLabel>
        <Input
          id="schedule-until-time"
          type="time"
          disabled={props.cadence.until === ""}
          value={props.cadence.untilTime}
          onChange={(event) => props.onChange({ untilTime: event.target.value })}
        />
      </Field>
    </div>
  )
}

function DateField(props: {
  label: string
  placeholder: string
  optional?: boolean | undefined
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const now = useNow()
  const selected = dateOfKey(props.value)
  return (
    <Field>
      <FieldLabel>
        {props.label}
        {props.optional ? <span className="text-xs font-normal text-muted-foreground">Optional</span> : null}
      </FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              className={cn(fieldTrigger, "w-full justify-start font-normal", !selected && "text-muted-foreground")}
              aria-label={`${props.label}: ${selected ? formatDate(selected) : props.placeholder}`}
            />
          }
        >
          <IconCalendar data-icon="inline-start" />
          {selected ? formatDate(selected) : props.placeholder}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 gap-2 p-3">
          <Calendar
            mode="single"
            selected={selected}
            disabled={{ before: new Date(now) }}
            onSelect={(day: Date | undefined) => {
              props.onChange(day ? dateKey(day) : "")
              setOpen(false)
            }}
            className="w-full p-0"
          />
          {selected ? (
            <>
              <Separator />
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => {
                  props.onChange("")
                  setOpen(false)
                }}
              >
                Clear
              </Button>
            </>
          ) : null}
        </PopoverContent>
      </Popover>
    </Field>
  )
}

function TimeZoneField(props: { value: string; onChange: (value: string) => void }) {
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase().replaceAll(" ", "_")
  const matches = timeZones().filter((zone) => zone.toLowerCase().includes(needle))
  return (
    <Field>
      <FieldLabel>Timezone</FieldLabel>
      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) setQuery("")
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              className={cn(fieldTrigger, "w-full justify-between font-normal")}
              aria-label={`Timezone: ${props.value}`}
            />
          }
        >
          {props.value.replaceAll("_", " ")}
          <IconChevronDown data-icon="inline-end" className="text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-72">
          <MenuSearch value={query} onChange={setQuery} placeholder="Search timezones…" />
          {matches.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">No timezones match “{query.trim()}”</p>
          ) : null}
          <DropdownMenuRadioGroup value={props.value} onValueChange={(value: string) => props.onChange(value)}>
            {matches.map((zone) => (
              <DropdownMenuRadioItem key={zone} value={zone} closeOnClick>
                {zone.replaceAll("_", " ")}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </Field>
  )
}
