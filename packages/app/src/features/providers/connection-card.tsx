import { RenInference } from "@ren/schema/ren-inference"
import { Avatar } from "@ren/ui/avatar"
import { Badge } from "@ren/ui/badge"
import { Button } from "@ren/ui/button"
import { Card } from "@ren/ui/card"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { InlineEdit } from "@ren/ui/inline-edit"
import { ProgressIndicator } from "@ren/ui/progress-indicator"
import type { StatusTone } from "@ren/ui/status-dot"
import { Text } from "@ren/ui/text"
import { Time } from "@ren/ui/time"
import { Schema } from "effect"

const STATUS_TONE: Record<RenInference.Tone, StatusTone> = {
  ok: "success",
  warn: "warning",
  error: "danger",
}

const label = Schema.toStandardSchemaV1(RenInference.RenameInput.fields.label)

export function ConnectionCard(props: {
  connection: RenInference.Connection
  index: number
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
    <Card.Root
      layout="tile"
      appearanceOrder={props.index}
      media={
        <Avatar.Root
          name={connection.providerName}
          image={connection.iconUrl}
          shape="square"
          imageFit="contain"
          size="medium"
          decorative
        />
      }
      mediaPlacement="inline"
      title={
        manage ? (
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
        )
      }
      description={
        <span className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[connection.status.tone]} size="medium">
            {connection.status.label}
          </Badge>
          {connection.plan ? <span>· {connection.plan}</span> : null}
        </span>
      }
      actions={
        manage ? (
          <>
            {connection.canReconnect ? (
              <Button appearance="secondary" size="small" onClick={manage.onReconnect}>
                Reconnect
              </Button>
            ) : null}
            <IconButton label={`Remove ${connection.label}`} onClick={manage.onRemove}>
              <Icon glyph="Trash2" />
            </IconButton>
          </>
        ) : undefined
      }
    >
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
    </Card.Root>
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
      <ProgressIndicator presentation="bar" label={props.meter.title} value={used ?? 0} tone="accent" />
    </li>
  )
}
