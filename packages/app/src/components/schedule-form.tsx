import { createContext, use, useState, type ReactNode } from "react"
import type { ScheduleInfo } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { IconCalendar, IconCheck, IconClock } from "@tabler/icons-react"
import { Equal, Option } from "effect"
import { toast } from "@ren/ui/sonner"
import { Button } from "@ren/ui/button"
import { Calendar } from "@ren/ui/calendar"
import { Field, FieldDescription, FieldError, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@ren/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Separator } from "@ren/ui/separator"
import { Switch } from "@ren/ui/switch"
import { Textarea } from "@ren/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@ren/ui/toggle-group"
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
  monthDays,
  nameOf,
  preview,
  weekdays,
  whenOf,
} from "../lib/schedules.js"
import { RouterContext } from "../lib/router-context.js"
import { TimeZone } from "../lib/time-zone.js"
import { SpaceField } from "./space-field.js"
import { TimeZonePicker } from "./time-zone-picker.js"

const defaultAgent = "default"

export interface ScheduleChat {
  readonly spaceId: string
  readonly sessionId: string
}

interface Draft {
  readonly name: string
  readonly message: string
  readonly spaceId: string
  readonly agentId: string
  readonly cadence: Cadence
  readonly active: boolean
}

interface Form {
  readonly state: {
    readonly draft: Draft
    readonly changed: boolean
    readonly error: string
    readonly saving: boolean
  }
  readonly actions: {
    readonly set: (patch: Partial<Omit<Draft, "cadence">>) => void
    readonly setCadence: (patch: Partial<Cadence>) => void
    readonly save: () => void
  }
  readonly meta: {
    readonly schedule: ScheduleInfo | undefined
    readonly toChat: boolean
  }
}

const FormContext = createContext<Form | undefined>(undefined)

export function useScheduleForm() {
  const form = use(FormContext)
  if (!form) throw new Error("useScheduleForm needs a ScheduleFormProvider")
  return form
}

const fieldTrigger =
  "border-input bg-card text-foreground hover:bg-card hover:text-foreground aria-expanded:bg-card aria-expanded:text-foreground"

const agentOptionsOf = (
  agents: ReadonlyArray<{ readonly id: string; readonly name: string; readonly organizationId: string | null }> = [],
) => [
  { value: defaultAgent, label: "Space default" },
  ...agents.filter((agent) => agent.organizationId !== null).map((agent) => ({ value: agent.id, label: agent.name })),
]

const createTarget = (chat: ScheduleChat | undefined, agentId: string | undefined) =>
  chat
    ? { target: { sessionId: chat.sessionId } }
    : { target: "new-chat" as const, ...(agentId !== undefined && { agentId }) }

const draftOf = (schedule: ScheduleInfo | undefined, spaceId: string, zone: string): Draft => ({
  name: schedule?.name ?? "",
  message: schedule?.message ?? "",
  spaceId: schedule?.spaceId ?? spaceId,
  agentId: schedule?.agentId ?? defaultAgent,
  cadence: cadenceOf(schedule?.when, zone),
  active: schedule ? schedule.status === "active" : true,
})

function problemOf(draft: Draft, when: Option.Option<unknown>) {
  if (draft.message.trim() === "") return "Write a prompt for the agent."
  if (draft.spaceId === "") return "Choose a space."
  if (Option.isNone(when)) return draft.cadence.frequency === "once" ? "Pick a date and a time." : "Pick a time."
  if (preview(draft.cadence).kind === "invalid")
    return 'Use a cron expression with five fields, for example "0 9 * * *".'
  return ""
}

export function ScheduleFormProvider(props: {
  schedule?: ScheduleInfo | undefined
  spaceId?: string | undefined
  chat?: ScheduleChat | undefined
  onSaved?: (() => void) | undefined
  children: ReactNode
}) {
  const { api, platform } = RouterContext.useRouterContext()
  const spaces = useSpaces()
  const schedule = props.schedule
  const [base, setBase] = useState(() =>
    draftOf(
      schedule,
      props.chat?.spaceId ?? props.spaceId ?? spaces.joined.at(0)?.id ?? "",
      TimeZone.current(platform.storage),
    ),
  )
  const [draft, setDraft] = useState(base)
  const [error, setError] = useState("")
  const create = useMutation(api.schedule.create.mutationOptions())
  const update = useMutation(api.schedule.update.mutationOptions())
  const pause = useMutation(api.schedule.pause.mutationOptions())
  const resume = useMutation(api.schedule.resume.mutationOptions())
  const toChat = props.chat !== undefined || (schedule !== undefined && schedule.target !== "new-chat")
  const save = () => {
    const when = whenOf(draft.cadence)
    const problem = problemOf(draft, when)
    setError(problem)
    if (problem || Option.isNone(when)) return
    const fields = { name: draft.name.trim() || nameOf(draft.message), message: draft.message.trim(), when: when.value }
    const onError = (failure: unknown) =>
      toast.error(schedule ? "Could not save the schedule" : "Could not create the schedule", {
        description: errorMessage(failure),
      })
    const agent = draft.agentId === defaultAgent ? undefined : draft.agentId
    if (schedule)
      return void update
        .mutateAsync({ id: schedule.id, ...fields, ...(!toChat && { agentId: agent ?? null }) })
        .then((saved) => {
          if (draft.active === base.active) return saved
          return (draft.active ? resume : pause).mutateAsync({ id: schedule.id })
        })
        .then((saved) => {
          const next = draftOf(saved, saved.spaceId, TimeZone.current(platform.storage))
          setBase(next)
          setDraft(next)
          props.onSaved?.()
          toast.success("Schedule saved")
        }, onError)
    return create.mutate(
      { spaceId: draft.spaceId, ...fields, ...createTarget(props.chat, agent) },
      {
        onSuccess: () => {
          props.onSaved?.()
          toast.success("Schedule created")
        },
        onError,
      },
    )
  }
  const form: Form = {
    state: {
      draft,
      changed: !Equal.equals(draft, base),
      error,
      saving: create.isPending || update.isPending || pause.isPending || resume.isPending,
    },
    actions: {
      set: (patch) => setDraft((previous) => ({ ...previous, ...patch })),
      setCadence: (patch) => setDraft((previous) => ({ ...previous, cadence: { ...previous.cadence, ...patch } })),
      save,
    },
    meta: { schedule, toChat },
  }
  return <FormContext value={form}>{props.children}</FormContext>
}

export function ScheduleFields() {
  const { api } = RouterContext.useRouterContext()
  const form = useScheduleForm()
  const spaces = useSpaces()
  const draft = form.state.draft
  const agents = useQuery({
    ...api.agent.list.queryOptions({ page: 1, pageSize: pickerPageSize, isSubagent: false, spaceId: draft.spaceId }),
    enabled: draft.spaceId !== "",
  })
  const toChat = form.meta.toChat
  return (
    <>
      <div className="flex items-end gap-4">
        <Field className="flex-1">
          <FieldLabel htmlFor="schedule-name">Name</FieldLabel>
          <Input
            id="schedule-name"
            value={draft.name}
            onChange={(event) => form.actions.set({ name: event.target.value })}
            placeholder="Uses the prompt’s first line"
          />
        </Field>
        {form.meta.schedule ? (
          <Field
            orientation="horizontal"
            className="min-h-8 w-auto shrink-0"
            data-disabled={form.meta.schedule.status === "ended" || undefined}
          >
            <Switch
              id="schedule-active"
              checked={draft.active}
              disabled={form.meta.schedule.status === "ended"}
              onCheckedChange={(active) => form.actions.set({ active })}
            />
            <FieldLabel htmlFor="schedule-active">Active</FieldLabel>
          </Field>
        ) : null}
      </div>
      <Field>
        <FieldLabel htmlFor="schedule-prompt">Prompt</FieldLabel>
        <Textarea
          id="schedule-prompt"
          value={draft.message}
          onChange={(event) => form.actions.set({ message: event.target.value })}
          placeholder="What should the agent do?"
          className="max-h-60 min-h-24"
        />
      </Field>
      {toChat || form.meta.schedule ? null : (
        <SpaceField
          spaces={spaces.joined}
          value={draft.spaceId}
          onChange={(spaceId) => form.actions.set({ spaceId, agentId: defaultAgent })}
        />
      )}
      <CadenceFields cadence={draft.cadence} onChange={form.actions.setCadence} />
      {toChat ? null : (
        <AgentField
          options={agentOptionsOf(agents.data?.items)}
          value={draft.agentId}
          onChange={(agentId) => form.actions.set({ agentId })}
        />
      )}
      <TimeZoneField value={draft.cadence.timeZone} onChange={(timeZone) => form.actions.setCadence({ timeZone })} />
      {draft.cadence.frequency === "once" ? null : (
        <UntilFields cadence={draft.cadence} onChange={form.actions.setCadence} />
      )}
      {form.state.error ? <FieldError>{form.state.error}</FieldError> : null}
    </>
  )
}

function CadenceFields(props: { cadence: Cadence; onChange: (patch: Partial<Cadence>) => void }) {
  const frequency = props.cadence.frequency
  const next = preview(props.cadence)
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
          <TimeField label="Time" value={props.cadence.time} onChange={(time) => props.onChange({ time })} />
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
        {next.kind === "invalid"
          ? null
          : `${describeCadence(props.cadence)} · ${
              next.kind === "never" ? "No runs left" : `Next ${formatRun(next.at, props.cadence.timeZone)}`
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
      <TimeField
        label="Until time"
        placeholder="End of day"
        disabled={props.cadence.until === ""}
        value={props.cadence.untilTime}
        onChange={(untilTime) => props.onChange({ untilTime })}
      />
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

const timeSlots = Array.from({ length: 96 }, (_, index) => {
  const hours = Math.floor(index / 4)
  const minutes = (index % 4) * 15
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
})

const formatTime = (value: string) => {
  const [hours = 0, minutes = 0] = value.split(":").map(Number)
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`
}

const parseTime = (text: string) => {
  const match = /^\s*(\d{1,2})(?::?(\d{2}))?\s*([ap])?\.?m?\.?\s*$/iu.exec(text)
  if (!match) return
  const hour = Number(match[1])
  const minutes = Number(match[2] ?? "0")
  const meridiem = match[3]?.toLowerCase()
  if (minutes > 59 || hour > 23 || (meridiem && (hour < 1 || hour > 12))) return
  const hours = meridiem ? (hour % 12) + (meridiem === "p" ? 12 : 0) : hour
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

function TimeField(props: {
  label: string
  value: string
  placeholder?: string | undefined
  disabled?: boolean | undefined
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const parsed = parseTime(typed)
  const typedSlots = parsed ? [parsed] : []
  const slots = typed.trim() ? typedSlots : timeSlots
  const anchor = timeSlots.findLast((slot) => slot <= (props.value || "09:00"))
  const pick = (value: string) => {
    props.onChange(value)
    setOpen(false)
  }
  return (
    <Field>
      <FieldLabel>{props.label}</FieldLabel>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setTyped("")
        }}
      >
        <PopoverTrigger
          disabled={props.disabled}
          render={
            <Button
              variant="outline"
              className={cn(fieldTrigger, "w-full justify-start font-normal", !props.value && "text-muted-foreground")}
              aria-label={`${props.label}: ${props.value ? formatTime(props.value) : (props.placeholder ?? "None")}`}
            />
          }
        >
          <IconClock data-icon="inline-start" />
          <span className="tabular-nums">
            {props.value ? formatTime(props.value) : (props.placeholder ?? "Pick a time")}
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--anchor-width) min-w-44 gap-0 p-0">
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && parsed) pick(parsed)
            }}
            placeholder="Type a time, like 9:30 pm"
            aria-label="Type a time"
            className="h-10 rounded-none border-0 border-b bg-transparent focus-visible:ring-0"
          />
          <div className="flex max-h-60 flex-col overflow-y-auto overscroll-contain p-1">
            {slots.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">Not a time</p>
            ) : null}
            {slots.map((slot) => (
              <Button
                key={slot}
                variant="ghost"
                size="sm"
                aria-pressed={slot === props.value}
                ref={(node) => {
                  const list = node?.parentElement
                  // ast-grep-ignore: no-manual-scroll -- centres the chosen time in the open list, not a chat
                  if (node && list && slot === anchor) list.scrollTop = node.offsetTop - list.clientHeight / 2
                }}
                onClick={() => pick(slot)}
                className="justify-between font-normal tabular-nums aria-pressed:bg-accent"
              >
                {formatTime(slot)}
                {slot === props.value ? <IconCheck className="text-muted-foreground" /> : null}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </Field>
  )
}

function TimeZoneField(props: { value: string; onChange: (value: string) => void }) {
  return (
    <Field>
      <FieldLabel>Timezone</FieldLabel>
      <TimeZonePicker value={props.value} onChange={props.onChange} className={cn(fieldTrigger, "w-full")} />
    </Field>
  )
}
