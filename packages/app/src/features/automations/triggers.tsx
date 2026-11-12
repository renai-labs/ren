import type { WebhookInfo } from "@ren/client"
import { Link } from "@tanstack/react-router"
import {
  IconAlertTriangle,
  IconChevronDown,
  IconClockBolt,
  IconCopy,
  IconKey,
  IconPlus,
  IconSettings,
  IconTrash,
} from "@tabler/icons-react"
import { Alert, AlertDescription } from "@ren/ui/alert"
import { Button, buttonVariants } from "@ren/ui/button"
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
import { formatRun, monthDays, weekdays, type Cadence, type Frequency } from "../../lib/schedules.js"
import { Automations } from "../../lib/automations.js"
import { Webhooks } from "../../lib/webhooks.js"
import { useNow } from "../../lib/use-now.js"

const scheduleChoices: ReadonlyArray<{ readonly frequency: Frequency; readonly label: string }> = [
  { frequency: "hourly", label: "Hourly" },
  { frequency: "daily", label: "Daily" },
  { frequency: "weekly", label: "Weekly" },
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
    <InlineSelect
      label="Time"
      value={props.value}
      items={Automations.timesWith(props.value).map((time) => ({ value: time, label: time }))}
      onChange={props.onChange}
    />
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
  if (cadence.frequency === "once") return <span>Once</span>
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

function TriggerRow(props: { actions: React.ReactNode; children: React.ReactNode }) {
  return (
    <Item size="sm" className="min-h-10 py-1.5 hover:bg-muted/50">
      <ItemMedia variant="icon" className="text-muted-foreground">
        <IconClockBolt />
      </ItemMedia>
      <ItemContent className="min-w-0 flex-row flex-wrap items-center gap-x-2 gap-y-1">{props.children}</ItemContent>
      <ItemActions>{props.actions}</ItemActions>
    </Item>
  )
}

// oxlint-disable-next-line ren/no-comments -- The triggers of an automation in one card, and the button that adds one under a line.
export function TriggerList(props: { children: ReadonlyArray<React.ReactNode>; add: React.ReactNode }) {
  return (
    <ItemGroup className="gap-0 rounded-xl border bg-card p-1 has-data-[size=sm]:gap-0">
      {props.children}
      {props.children.length > 0 ? <ItemSeparator className="my-1" /> : null}
      {props.add}
    </ItemGroup>
  )
}

export function ScheduleTrigger(props: {
  cadence: Cadence
  onChange: (patch: Partial<Cadence>) => void
  onRemove: () => void
}) {
  const now = useNow()
  const next = Automations.nextRuns(props.cadence, 1, now)[0]
  return (
    <TriggerRow actions={<RemoveButton label="Remove schedule" onRemove={props.onRemove} />}>
      <ScheduleSentence cadence={props.cadence} onChange={props.onChange} />
      {next ? <span className="text-muted-foreground">Next run {formatRun(next, props.cadence.timeZone)}</span> : null}
    </TriggerRow>
  )
}

function WebhookSettingsLink(props: { spaceId: string; webhook: WebhookInfo }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to="/spaces/$spaceId/webhooks/$webhookId"
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
  spaceId: string
  onCopyUrl: (webhook: WebhookInfo) => void
  onCopyAuthHeader: (webhook: WebhookInfo) => void
  onRemove: () => void
}) {
  const webhook = props.webhook
  const signed = webhook?.parser?.signature?.kind === "header" && webhook.hasSigningSecret
  return (
    <TriggerRow
      actions={
        <>
          {webhook ? <WebhookSettingsLink spaceId={props.spaceId} webhook={webhook} /> : null}
          <RemoveButton label="Remove webhook" onRemove={props.onRemove} />
        </>
      }
    >
      <span>{webhook?.preset ? `${webhook.preset.appName} · ${webhook.name}` : "Webhook"}</span>
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
          {webhook.preset ? null : (
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

export function AddTrigger(props: {
  taken: ReadonlyArray<"schedule" | "webhook">
  onSchedule: (frequency: Frequency) => void
  onWebhook: () => void
}) {
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
        <IconPlus data-icon="inline-start" />
        Add trigger
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {props.taken.includes("schedule") ? "Change schedule" : "Scheduled"}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {scheduleChoices.map((choice) => (
                <DropdownMenuItem key={choice.frequency} onClick={() => props.onSchedule(choice.frequency)}>
                  {choice.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem disabled={props.taken.includes("webhook")} onClick={props.onWebhook}>
            Webhook triggered
          </DropdownMenuItem>
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
