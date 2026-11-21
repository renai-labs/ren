import type { ReactNode } from "react"
import { cn } from "cn"

export function Stat(props: { label: string; value: string; detail?: ReactNode | undefined }) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-1">
      <span className="text-xs text-muted-foreground">{props.label}</span>
      <span className="text-xl font-medium tabular-nums">{props.value}</span>
      {props.detail ? <span className="text-xs text-muted-foreground tabular-nums">{props.detail}</span> : null}
    </span>
  )
}

export function Trend(props: { current: number; previous: number | undefined; upIsGood: boolean }) {
  if (!props.previous) return null
  const ratio = props.current / props.previous
  const percent = Math.round(Math.abs(ratio - 1) * 100)
  if (percent === 0) return <>No change</>
  const up = ratio > 1
  return (
    <span className={cn(up === props.upIsGood ? "text-chart-2" : "text-destructive")}>
      {up ? "▲" : "▼"} {percent >= 1000 ? `${Math.round(ratio)}×` : `${percent}%`}
    </span>
  )
}
