import { useState } from "react"
import type { WebhookInfo } from "@ren/client"
import { Link } from "@tanstack/react-router"
import {
  IconAlertTriangle,
  IconArrowsExchange,
  IconCalendar,
  IconChevronDown,
  IconClock,
  IconWebhook,
  IconCopy,
  IconKey,
  IconPlus,
  IconSettings,
  IconTrash,
} from "@tabler/icons-react"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { cn } from "cn"
import { Button, buttonVariants } from "@ren/ui/button"
import { Calendar } from "@ren/ui/calendar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Field, FieldDescription, FieldLabel } from "@ren/ui/field"
import { Input } from "@ren/ui/input"
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemSeparator } from "@ren/ui/item"
import { Popover, PopoverContent, PopoverTrigger } from "@ren/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@ren/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { formatDate } from "@ren/ui/time"
import {
  dateKey,
  dateOfKey,
  formatRun,
  monthDays,
  weekdays,
  type Cadence,
  type Frequency,
} from "../../lib/schedules.js"
import { Automations } from "../../lib/automations.js"
import type { AppPreset } from "../../lib/use-automations.js"
import { Webhooks } from "../../lib/webhooks.js"
import { useNow } from "../../lib/use-now.js"

const scheduleChoices: ReadonlyArray<{ readonly frequency: Frequency; readonly label: string }> = [
  { frequency: "hourly", label: "Hourly" },
  { frequency: "daily", label: "Daily" },
  { frequency: "weekdays", label: "Weekdays" },
  { frequency: "weekly", label: "Weekly" },
  { frequency: "monthly", label: "Monthly" },
  { frequency: "once", label: "Once" },
  { frequency: "custom", label: "Custom (cron)" },
]

function InlineSelect(props: {
  label: string
  value: string
  items: ReadonlyArray<{ readonly value: string; readonly label: string }>
  onChange: (value: string) => void
}) {
  return (
    <Select items={props.items} value={props.value} onValueChange={(value) => props.onChange(String(value))}>
      <SelectTrigger size="sm" aria-label={props.label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {props.items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function TimeSelect(props: { value: string; onChange: (time: string) => void }) {
  return (
    <Input
      type="time"
      aria-label="Time"
      value={props.value}
      onChange={(event) => {
        if (event.target.value) props.onChange(event.target.value)
      }}
      className="h-8 w-auto"
    />
  )
}

export function DatePicker(props: {
  label: string
  placeholder: string
  value: string
  onChange: (date: string) => void
}) {
  const [open, setOpen] = useState(false)
  const now = useNow()
  const selected = dateOfKey(props.value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="font-normal"
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
      </PopoverContent>
    </Popover>
  )
}

function CronEditor(props: { cadence: Cadence; onChange: (cron: string) => void }) {
  const now = useNow()
  const runs = Automations.nextRuns(props.cadence, 3, now)
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="font-mono">
            {props.cadence.cron || "Set cron"}
            <IconChevronDown data-icon="inline-end" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-72">
        <Field data-invalid={runs.length === 0}>
          <FieldLabel htmlFor="automation-cron">Cron expression ({props.cadence.timeZone})</FieldLabel>
          <Input
            id="automation-cron"
            value={props.cadence.cron}
            onChange={(event) => props.onChange(event.target.value)}
            className="font-mono"
            aria-invalid={runs.length === 0}
          />
          <FieldDescription>
            {runs.length > 0
              ? runs.map((run) => formatRun(run, props.cadence.timeZone)).join(" · ")
              : "This expression never runs. Use five fields, for example 0 9 * * 1-5."}
          </FieldDescription>
        </Field>
      </PopoverContent>
    </Popover>
  )
}

function ScheduleSentence(props: { cadence: Cadence; onChange: (patch: Partial<Cadence>) => void }) {
  const cadence = props.cadence
  const time = <TimeSelect value={cadence.time} onChange={(next) => props.onChange({ time: next })} />
  if (cadence.frequency === "hourly") return <span>Every hour</span>
  if (cadence.frequency === "daily")
    return (
      <>
        <span>Every day at</span>
        {time}
      </>
    )
  if (cadence.frequency === "weekdays")
    return (
      <>
        <span>Every weekday at</span>
        {time}
      </>
    )
  if (cadence.frequency === "weekly")
    return (
      <>
        <span>Every week on</span>
        <InlineSelect
          label="Day"
          value={cadence.weekday.split(",")[0] ?? "1"}
          items={weekdays}
          onChange={(weekday) => props.onChange({ weekday })}
        />
        <span>at</span>
        {time}
      </>
    )
  if (cadence.frequency === "monthly")
    return (
      <>
        <span>Every month on</span>
        <InlineSelect
          label="Day of the month"
          value={cadence.monthDay}
          items={monthDays}
          onChange={(monthDay) => props.onChange({ monthDay })}
        />
        <span>at</span>
        {time}
      </>
    )
  if (cadence.frequency === "once")
    return (
      <>
        <span>Once on</span>
        <DatePicker
          label="Date"
          placeholder="Pick a date"
          value={cadence.date}
          onChange={(date) => props.onChange({ date })}
        />
        <span>at</span>
        {time}
      </>
    )
  return (
    <>
      <span>Custom schedule</span>
      <CronEditor cadence={cadence} onChange={(cron) => props.onChange({ cron })} />
    </>
  )
}

function RemoveButton(props: { label: string; onRemove: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={props.label}
            onClick={props.onRemove}
            className="text-muted-foreground opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100"
          >
            <IconTrash />
          </Button>
        }
      />
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  )
}

function TriggerRow(props: { kind: "schedule" | "webhook"; actions: React.ReactNode; children: React.ReactNode }) {
  return (
    <Item size="sm" className="min-h-10 py-1.5 hover:bg-muted/50">
      <ItemMedia variant="icon" className="text-muted-foreground">
        {props.kind === "schedule" ? <IconClock /> : <IconWebhook />}
      </ItemMedia>
      <ItemContent className="min-w-0 flex-row flex-wrap items-center gap-x-2 gap-y-1">{props.children}</ItemContent>
      <ItemActions>{props.actions}</ItemActions>
    </Item>
  )
}

// oxlint-disable-next-line ren/no-comments -- The one trigger of an automation in a card, and the button that adds or changes it under a line.
export function TriggerList(props: { children: React.ReactNode; add: React.ReactNode }) {
  return (
    <ItemGroup className="gap-0 rounded-xl border bg-card p-1 has-data-[size=sm]:gap-0">
      {props.children}
      {props.children ? <ItemSeparator className="my-1" /> : null}
      {props.add}
    </ItemGroup>
  )
}

export function ScheduleTrigger(props: {
  cadence: Cadence
  active: boolean
  onChange: (patch: Partial<Cadence>) => void
  onRemove: (() => void) | undefined
}) {
  const now = useNow()
  const next = Automations.nextRuns(props.cadence, 1, now)[0]
  return (
    <TriggerRow
      kind="schedule"
      actions={props.onRemove ? <RemoveButton label="Remove schedule" onRemove={props.onRemove} /> : null}
    >
      <ScheduleSentence cadence={props.cadence} onChange={props.onChange} />
      {next && props.active ? (
        <span className="text-muted-foreground">Next run {formatRun(next, props.cadence.timeZone)}</span>
      ) : null}
    </TriggerRow>
  )
}

function WebhookSettingsLink(props: { spaceId: string; webhook: WebhookInfo }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to="/spaces/$spaceId/automations/webhooks/$webhookId"
            params={{ spaceId: props.spaceId, webhookId: props.webhook.id }}
            aria-label="Requests and parser"
            className={buttonVariants({
              variant: "ghost",
              size: "icon-sm",
              className:
                "text-muted-foreground opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100",
            })}
          >
            <IconSettings />
          </Link>
        }
      />
      <TooltipContent>Requests and parser</TooltipContent>
    </Tooltip>
  )
}

export function WebhookTrigger(props: {
  webhook: WebhookInfo | undefined
  label: string
  spaceId: string
  onCopyUrl: (webhook: WebhookInfo) => void
  onCopyAuthHeader: (webhook: WebhookInfo) => void
  onRemove: (() => void) | undefined
}) {
  const webhook = props.webhook
  const signed = webhook?.parser?.signature?.kind === "header" && webhook.hasSigningSecret
  return (
    <TriggerRow
      kind="webhook"
      actions={
        <>
          {webhook ? <WebhookSettingsLink spaceId={props.spaceId} webhook={webhook} /> : null}
          {props.onRemove ? <RemoveButton label="Remove webhook" onRemove={props.onRemove} /> : null}
        </>
      }
    >
      <span>{props.label}</span>
      {webhook ? (
        <>
          <Button
            variant="outline"
            size="sm"
            className="max-w-64 min-w-0 font-normal"
            onClick={() => props.onCopyUrl(webhook)}
            title={`Copy ${webhook.url}`}
          >
            <span className="truncate">{webhook.url}</span>
            <IconCopy data-icon="inline-end" />
          </Button>
          {webhook.preset ? (
            <Link
              to="/spaces/$spaceId/automations/webhooks/$webhookId"
              params={{ spaceId: props.spaceId, webhookId: webhook.id }}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Setup steps
            </Link>
          ) : (
            <Button variant="outline" size="sm" onClick={() => props.onCopyAuthHeader(webhook)}>
              <IconKey data-icon="inline-start" />
              {signed ? "Copy auth header" : "Generate auth header"}
            </Button>
          )}
        </>
      ) : (
        <span className="text-muted-foreground">Save to get its URL</span>
      )}
    </TriggerRow>
  )
}

function PresetItem(props: { preset: AppPreset; current: boolean; onPick: (preset: AppPreset) => void }) {
  const preset = props.preset
  return (
    // ast-grep-ignore: require-item-group -- rows render inside the trigger menu's DropdownMenuGroup
    <DropdownMenuItem
      disabled={props.current || preset.turnedOn}
      onClick={() => props.onPick(preset)}
      className="items-start gap-2.5"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate">
          {preset.appName} · {preset.name}
        </span>
        <span className="text-xs text-muted-foreground">{preset.description}</span>
      </span>
      {props.current || preset.turnedOn ? (
        <span className="ml-auto text-xs">{props.current ? "Current" : "On"}</span>
      ) : null}
    </DropdownMenuItem>
  )
}

// oxlint-disable-next-line ren/no-comments -- current is "schedule", "webhook" or the key of an app’s preset. A saved schedule passes only "schedule": its kind is set when it is made, and only how often it runs can change.
export function AddTrigger(props: {
  current: string | undefined
  only: "schedule" | undefined
  presets: ReadonlyArray<AppPreset>
  onSchedule: (frequency: Frequency) => void
  onWebhook: () => void
  onPreset: (preset: AppPreset) => void
}) {
  const label = props.current ? "Change trigger" : "Add trigger"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="h-10 w-full justify-start gap-2.5 px-3 font-normal text-muted-foreground has-data-[icon=inline-start]:pl-3"
          />
        }
      >
        {props.current ? <IconArrowsExchange data-icon="inline-start" /> : <IconPlus data-icon="inline-start" />}
        {props.only ? "Change schedule" : label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Schedule</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {scheduleChoices.map((choice) => (
                <DropdownMenuItem key={choice.frequency} onClick={() => props.onSchedule(choice.frequency)}>
                  {choice.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {props.only ? null : (
            <DropdownMenuItem disabled={props.current === "webhook"} onClick={props.onWebhook}>
              Webhook
              {props.current === "webhook" ? <span className="ml-auto text-xs">Current</span> : null}
            </DropdownMenuItem>
          )}
          {props.presets.length > 0 && !props.only ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>From an app</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-72">
                {props.presets.map((preset) => (
                  <PresetItem
                    key={Automations.presetKey(preset)}
                    preset={preset}
                    current={props.current === Automations.presetKey(preset)}
                    onPick={props.onPreset}
                  />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TriggerWarning(props: { webhook: WebhookInfo | undefined; active: boolean }) {
  const webhook = props.webhook
  if (!webhook) return null
  const reason = webhook.modeReason ? Webhooks.modeReasons[webhook.modeReason] : undefined
  const blocked = props.active && webhook.mode === "listening" && !Webhooks.canGoLive(webhook)
  if (!reason && !blocked) return null
  return (
    <Alert>
      <IconAlertTriangle />
      <AlertDescription>
        {reason ?? "The webhook needs its signing secret before it can run. Open its settings to paste it."}
      </AlertDescription>
    </Alert>
  )
}
