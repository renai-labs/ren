import type { ReactNode } from "react"

export function Stat(props: { label: string; value: string; detail?: ReactNode | undefined }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{props.label}</span>
      <span className="flex items-baseline gap-1.5 text-base font-medium tabular-nums">
        {props.value}
        {props.detail ? <span className="text-xs font-normal text-muted-foreground">{props.detail}</span> : null}
      </span>
    </div>
  )
}
