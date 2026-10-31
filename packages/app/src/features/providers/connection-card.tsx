import { RenInference } from "@ren/schema/ren-inference"
import { Avatar, AvatarFallback, AvatarImage } from "@ren/ui/avatar"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@ren/ui/card"
import { Icon } from "@ren/ui/icon"
import { InlineEdit } from "@ren/ui/inline-edit"
import { Progress } from "@ren/ui/progress"
import { Text } from "@ren/ui/text"
import { Time } from "@ren/ui/time"
import { Initials } from "@ren/util/initials"
import { Schema } from "effect"

const STATUS_TONE: Record<RenInference.Tone, string> = {
  ok: "bg-status-success/10 text-status-success",
  warn: "bg-status-warning/10 text-status-warning",
  error: "bg-destructive/10 text-destructive",
}

const label = Schema.toStandardSchemaV1(RenInference.RenameInput.fields.label)

export function ConnectionCard(props: {
  connection: RenInference.Connection
  now: number
  manage?: {
    onRename: (label: string) => Promise<void>
    onRemove: () => void
    onReconnect: () => void
  }
}) {
  const connection = props.connection
  const manage = props.manage
  return (
    <Card className="animate-entrance gap-3 border px-4 ring-0 motion-reduce:animate-none">
      <CardHeader className="flex items-center gap-3 px-0">
        <Avatar aria-hidden className="rounded-lg after:rounded-lg">
          <AvatarImage src={connection.iconUrl} alt="" className="m-auto size-3/4 rounded-none object-contain" />
          <AvatarFallback className="rounded-lg">{Initials.of(connection.providerName)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <CardTitle className="truncate text-sm">
            {manage ? (
              <InlineEdit
                key={connection.label}
                label="Connection name"
                value={connection.label}
                placeholder="Team account"
                schema={label}
                onCommit={(next) => manage.onRename(next.trim())}
              />
            ) : (
              connection.label
            )}
          </CardTitle>
          <CardDescription className="flex items-center gap-2 text-xs">
            <Badge variant="secondary" className={STATUS_TONE[connection.status.tone]}>
              {connection.status.label}
            </Badge>
            {connection.plan ? <span>· {connection.plan}</span> : null}
          </CardDescription>
        </div>
        {manage ? (
          <CardAction className="flex items-center gap-1 self-center">
            {connection.canReconnect ? (
              <Button variant="secondary" size="sm" onClick={manage.onReconnect}>
                Reconnect
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={`Remove ${connection.label}`}
              onClick={manage.onRemove}
            >
              <Icon glyph="Trash2" />
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="px-0">
        {connection.meters.length === 0 ? (
          <Text purpose="caption" tone="secondary">
            {connection.canReconnect ? "Sign in again to keep using it." : "Usage appears after the first request."}
          </Text>
        ) : (
          <ul className="flex flex-col gap-3">
            {connection.meters.map((meter) => (
              <Meter key={meter.key} meter={meter} now={props.now} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function Meter(props: { meter: RenInference.Meter; now: number }) {
  const used = props.meter.percent
  const resets = props.meter.resetsAt && Date.parse(props.meter.resetsAt) > props.now ? props.meter.resetsAt : null
  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <Text purpose="caption" element="span" truncation="single-line">
          {props.meter.title}
        </Text>
        <span className="flex shrink-0 items-baseline gap-2">
          <Text purpose="caption" element="span" numerals="tabular">
            {used === null ? "—" : `${used}%`}
          </Text>
          {resets ? (
            <Text purpose="caption" tone="secondary" element="span" numerals="tabular">
              <Time value={resets} format="relative" relativeStyle="narrow" label="Resets" />
            </Text>
          ) : null}
        </span>
      </div>
      <Progress
        value={used ?? 0}
        aria-label={props.meter.title}
        className="**:data-[slot=progress-indicator]:bg-accent-primary **:data-[slot=progress-track]:bg-secondary"
      />
    </li>
  )
}
