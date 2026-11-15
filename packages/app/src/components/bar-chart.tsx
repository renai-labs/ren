import { cn } from "cn"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"

export type BarSeries = { readonly label: string; readonly fill: string; readonly swatch: string }

export type Bar = { readonly key: string; readonly label: string; readonly values: ReadonlyArray<number> }

const sum = (values: ReadonlyArray<number>) => values.reduce((total, value) => total + value, 0)

function Column(props: { bar: Bar; series: ReadonlyArray<BarSeries>; max: number }) {
  const total = sum(props.bar.values)
  const tops = props.bar.values.map((_, index) => sum(props.bar.values.slice(0, index + 1)))
  return (
    <svg viewBox="0 0 1 100" preserveAspectRatio="none" aria-hidden className="size-full">
      {total === 0 ? <rect x="0" y="99" width="1" height="1" className="fill-border" /> : null}
      {props.series.map((series, index) => {
        const value = props.bar.values[index] ?? 0
        if (value === 0) return null
        const height = (value / props.max) * 100
        return (
          <rect
            key={series.label}
            x="0"
            y={100 - ((tops[index] ?? 0) / props.max) * 100}
            width="1"
            height={height}
            className={series.fill}
          />
        )
      })}
    </svg>
  )
}

export function BarChart(props: {
  label: string
  series: ReadonlyArray<BarSeries>
  bars: ReadonlyArray<Bar>
  format: (value: number) => string
  className?: string | undefined
}) {
  const max = Math.max(0, ...props.bars.map((bar) => sum(bar.values)))
  return (
    <figure className={cn("flex h-40 items-stretch gap-0.5", props.className)}>
      <figcaption className="sr-only">{props.label}</figcaption>
      {props.bars.map((bar) => (
        <Tooltip key={bar.key}>
          <TooltipTrigger render={<div className="min-w-0 flex-1 rounded-sm hover:bg-muted/60" />}>
            <Column bar={bar} series={props.series} max={max} />
          </TooltipTrigger>
          <TooltipContent>
            <div className="flex flex-col gap-0.5 tabular-nums">
              <span className="font-medium">{bar.label}</span>
              {props.series.length > 1 ? (
                props.series.map((series, index) => (
                  <span key={series.label}>
                    {series.label}: {props.format(bar.values[index] ?? 0)}
                  </span>
                ))
              ) : (
                <span>{props.format(sum(bar.values))}</span>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      ))}
    </figure>
  )
}

export function ChartLegend(props: { series: ReadonlyArray<BarSeries> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {props.series.map((series) => (
        <li key={series.label} className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-sm", series.swatch)} />
          {series.label}
        </li>
      ))}
    </ul>
  )
}
