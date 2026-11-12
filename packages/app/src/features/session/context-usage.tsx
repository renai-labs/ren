import { useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@ren/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@ren/ui/popover"
import { cn } from "cn"
import { formatCount, formatMicroUsd, formatTokens } from "../../lib/format.js"
import { RouterContext } from "../../lib/router-context.js"
import type { ContextUsage as Usage } from "./chat-view.js"

const amberFrom = 70
const redFrom = 90

const toneOf = (percent: number | undefined) => {
  if (percent === undefined) return { ring: "text-muted-foreground", words: undefined }
  if (percent >= redFrom) return { ring: "text-destructive", words: "Compact soon" }
  if (percent >= amberFrom) return { ring: "text-chart-3", words: "Context is filling up" }
  return { ring: "text-muted-foreground", words: undefined }
}

function Ring(props: { percent: number | undefined; className: string }) {
  const radius = 6
  const circumference = 2 * Math.PI * radius
  const fill = Math.min(100, props.percent ?? 0) / 100
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4 -rotate-90", props.className)} aria-hidden>
      <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeWidth="2" className="opacity-25" />
      {fill > 0 ? (
        <circle
          cx="8"
          cy="8"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${fill * circumference} ${circumference}`}
        />
      ) : null}
    </svg>
  )
}

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{props.label}</span>
      <span className="tabular-nums">{props.children}</span>
    </div>
  )
}

function Cost(props: { sessionId: string; open: boolean }) {
  const { api } = RouterContext.useRouterContext()
  const cost = useQuery({ ...api.link.session.usage.queryOptions({ id: props.sessionId }), enabled: props.open })
  const refetch = cost.refetch
  if (cost.isError)
    return (
      <Row label="Cost">
        <Button variant="link" size="sm" className="h-auto p-0" onClick={() => void refetch()}>
          Retry
        </Button>
      </Row>
    )
  if (!cost.data) return <Row label="Cost">—</Row>
  const parts = [
    { label: "LLM", value: cost.data.models },
    { label: "Tools", value: cost.data.tools },
  ].filter((part) => part.value > 0)
  return (
    <>
      <Row label="Cost">{cost.data.total > 0 ? formatMicroUsd(cost.data.total) : "$0.00"}</Row>
      {parts.map((part) => (
        <Row key={part.label} label={part.label}>
          {formatMicroUsd(part.value)}
        </Row>
      ))}
    </>
  )
}

export function ContextUsage(props: {
  sessionId: string
  usage: Usage | undefined
  onCompact: (() => void) | undefined
}) {
  const [open, setOpen] = useState(false)
  const usage = props.usage
  if (!usage) return null
  const tone = toneOf(usage.percent)
  const percent = usage.percent === undefined ? "" : ` (${usage.percent}%)`
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        aria-label={
          usage.percent === undefined
            ? `Context ${formatTokens(usage.tokens)} tokens used`
            : `Context ${usage.percent}% used`
        }
        render={<Button variant="ghost" size="sm" className="gap-1.5 tabular-nums" />}
      >
        <Ring percent={usage.percent} className={tone.ring} />
        <span className="text-muted-foreground">{formatTokens(usage.tokens)}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-2 p-3">
        <Row label="Context">
          {formatCount(usage.tokens)}
          {percent}
        </Row>
        <Cost sessionId={props.sessionId} open={open} />
        {tone.words ? <p className={cn("text-xs", tone.ring)}>{tone.words}</p> : null}
        {props.onCompact ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-1 w-full"
            onClick={() => {
              setOpen(false)
              props.onCompact?.()
            }}
          >
            Compact chat
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
