import { useState } from "react"
import type { ScheduleInfo } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { IconCalendar, IconChevronDown } from "@tabler/icons-react"
import { Option } from "effect"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { MenuSearch } from "@/components/ren/menu-search"
import { useNow } from "@/hooks/use-now"
import { useSpaces } from "@/hooks/use-spaces"
import { api, errorMessage, pickerPageSize } from "@/lib/api"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
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
} from "@/lib/schedules"

const defaultAgent = "default"

export function ScheduleSheet(props: {
  open: boolean
  version: number
  schedule: ScheduleInfo | undefined
  spaceId?: string | undefined
  onClose: () => void
}) {
  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <SheetContent>
        <ScheduleForm key={props.version} schedule={props.schedule} spaceId={props.spaceId} onClose={props.onClose} />
      </SheetContent>
    </Sheet>
  )
}

function ScheduleForm(props: { schedule: ScheduleInfo | undefined; spaceId: string | undefined; onClose: () => void }) {
  const schedule = props.schedule
  const spaces = useSpaces()
  const [message, setMessage] = useState(schedule?.message ?? "")
  const [spaceId, setSpaceId] = useState(schedule?.spaceId ?? props.spaceId ?? spaces.joined.at(0)?.id ?? "")
  const [agentId, setAgentId] = useState(schedule?.agentId ?? defaultAgent)
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
  const agentOptions = [
    { value: defaultAgent, label: "Space default" },
    ...(agents.data?.items ?? [])
      .filter((agent) => agent.organizationId !== null)
      .map((agent) => ({ value: agent.id, label: agent.name })),
  ]
  const frequency = cadence.frequency
  const frequencies = frequencyOptions.filter((option) => option.value !== "once" || frequency === "once")
  const timed = frequency !== "hourly" && frequency !== "custom"
  const save = () => {
    const when = whenOf(cadence)
    if (message.trim() === "") return setError("Write a prompt for the agent.")
    if (spaceId === "") return setError("Choose a space.")
    if (Option.isNone(when)) return setError(frequency === "once" ? "Pick a date and a time." : "Pick a time.")
    if (next.kind === "invalid") return setError('Use a cron expression with five fields, for example "0 9 * * *".')
    setError("")
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
    if (schedule)
      return update.mutate({ id: schedule.id, ...fields, agentId: agentId === defaultAgent ? null : agentId }, done)
    return create.mutate({ spaceId, ...fields, target: "new-chat", ...(agentId !== defaultAgent && { agentId }) }, done)
  }
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <SheetHeader>
        <SheetTitle>{schedule ? "Edit schedule" : "New schedule"}</SheetTitle>
        <SheetDescription>Run an agent on a recurring schedule.</SheetDescription>
      </SheetHeader>
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
        {schedule ? null : (
          <Field>
            <FieldLabel>Space</FieldLabel>
            <Select
              items={spaces.joined.map((space) => ({ value: space.id, label: space.name }))}
              value={spaceId}
              onValueChange={(value) => {
                setSpaceId(String(value))
                setAgentId(defaultAgent)
              }}
            >
              <SelectTrigger aria-label="Space" className="w-full">
                <SelectValue placeholder="Choose a space" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {spaces.joined.map((space) => (
                    <SelectItem key={space.id} value={space.id}>
                      {space.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        )}
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field className={timed ? undefined : "col-span-2"}>
              <FieldLabel>Frequency</FieldLabel>
              <Select
                items={frequencies}
                value={frequency}
                onValueChange={(value) => {
                  if (isFrequency(value)) set({ frequency: value })
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
                  value={cadence.time}
                  onChange={(event) => set({ time: event.target.value })}
                />
              </Field>
            ) : null}
          </div>
          {frequency === "weekly" ? (
            <ToggleGroup
              multiple
              variant="outline"
              spacing={1}
              aria-label="Days"
              className="w-full"
              value={cadence.weekday.split(",").filter(Boolean)}
              onValueChange={(values: string[]) =>
                set({
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
          {frequency === "monthly" ? (
            <Select
              items={monthDays}
              value={cadence.monthDay}
              onValueChange={(value) => set({ monthDay: String(value) })}
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
          {frequency === "once" ? (
            <DateField label="Date" placeholder="Pick a date" value={cadence.date} onChange={(date) => set({ date })} />
          ) : null}
          {frequency === "custom" ? (
            <Field>
              <Input
                aria-label="Cron expression"
                value={cadence.cron}
                onChange={(event) => set({ cron: event.target.value })}
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
              : `${describeCadence(cadence)} · ${
                  next.kind === "never" ? "No runs left" : `Next ${formatRun(next.at, cadence.timeZone)}`
                }`}
          </p>
        </div>
        <Field>
          <FieldLabel>Agent</FieldLabel>
          <Select items={agentOptions} value={agentId} onValueChange={(value) => setAgentId(String(value))}>
            <SelectTrigger aria-label="Agent" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {agentOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <TimeZoneField value={cadence.timeZone} onChange={(timeZone) => set({ timeZone })} />
        {frequency === "once" ? null : (
          <div className="grid grid-cols-2 gap-3">
            <DateField
              label="Until"
              placeholder="No end date"
              optional
              value={cadence.until}
              onChange={(until) => set({ until })}
            />
            <Field>
              <FieldLabel htmlFor="schedule-until-time">Until time</FieldLabel>
              <Input
                id="schedule-until-time"
                type="time"
                disabled={cadence.until === ""}
                value={cadence.untilTime}
                onChange={(event) => set({ untilTime: event.target.value })}
              />
            </Field>
          </div>
        )}
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
              className={cn("w-full justify-start font-normal", !selected && "text-muted-foreground")}
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
              className="w-full justify-between font-normal"
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
