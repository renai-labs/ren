import type { ReactNode } from "react"
import { cn } from "cn"

export function Stat(props: { label: string; value: string; detail?: ReactNode | undefined }) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-1.5">
      <span className="text-sm text-muted-foreground">{props.label}</span>
      <span className="text-2xl/tight font-medium tracking-heading text-foreground tabular-nums">{props.value}</span>
      {props.detail ? (
        <span className="text-xs font-medium text-muted-foreground tabular-nums">{props.detail}</span>
      ) : null}
    </span>
  )
}

export function Trend(props: {
  current: number
  previous: number | undefined
  upIsGood: boolean
  since?: string | undefined
}) {
  if (!props.previous) return null
  const ratio = props.current / props.previous
  const percent = Math.round(Math.abs(ratio - 1) * 100)
  const since = props.since ? ` ${props.since}` : ""
  if (percent === 0) return <>No change{since}</>
  const up = ratio > 1
  return (
    <>
      <span className={cn(up === props.upIsGood ? "text-chart-2" : "text-destructive")}>
        {up ? "↑" : "↓"} {percent >= 1000 ? `${Math.round(ratio)}×` : `${percent}%`}
      </span>
      {since}
    </>
  )
}
