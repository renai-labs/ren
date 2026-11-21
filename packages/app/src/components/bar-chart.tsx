import { cn } from "cn"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"

export type BarSeries = { readonly label: string; readonly fill: string; readonly swatch: string }

export type Bar = {
  readonly key: string
  readonly label: string
  readonly values: ReadonlyArray<number>
  readonly partial?: boolean | undefined
}

const sum = (values: ReadonlyArray<number>) => values.reduce((total, value) => total + value, 0)

const niceSteps = [1, 2, 2.5, 5, 10]

function niceMax(max: number) {
  if (max <= 0) return 1
  const scale = 10 ** Math.floor(Math.log10(max))
  return (niceSteps.find((step) => step * scale >= max) ?? 10) * scale
}

function Column(props: { bar: Bar; series: ReadonlyArray<BarSeries>; top: number }) {
  const tops = props.bar.values.map((_, index) => sum(props.bar.values.slice(0, index + 1)))
  return (
    <svg
      viewBox="0 0 1 100"
      preserveAspectRatio="none"
      aria-hidden
      className={cn("size-full", props.bar.partial && "opacity-50")}
    >
      {props.series.map((series, index) => {
        const value = props.bar.values[index] ?? 0
        if (value === 0) return null
        return (
          <rect
            key={series.label}
            x="0"
            y={100 - ((tops[index] ?? 0) / props.top) * 100}
            width="1"
            height={(value / props.top) * 100}
            className={series.fill}
          />
        )
      })}
    </svg>
  )
}

function BarDetail(props: { bar: Bar; series: ReadonlyArray<BarSeries>; format: (value: number) => string }) {
  return (
    <div className="flex flex-col gap-0.5 tabular-nums">
      <span className="font-medium">
        {props.bar.label}
        {props.bar.partial ? " (so far)" : ""}
      </span>
      {props.series.length > 1 ? (
        props.series.map((series, index) => (
          <span key={series.label}>
            {series.label}: {props.format(props.bar.values[index] ?? 0)}
          </span>
        ))
      ) : (
        <span>{props.format(sum(props.bar.values))}</span>
      )}
    </div>
  )
}

export function BarChart(props: {
  label: string
  series: ReadonlyArray<BarSeries>
  bars: ReadonlyArray<Bar>
  format: (value: number) => string
  className?: string | undefined
}) {
  const top = niceMax(Math.max(0, ...props.bars.map((bar) => sum(bar.values))))
  return (
    <figure className={cn("flex flex-col gap-2", props.className)}>
      <figcaption className="sr-only">{props.label}</figcaption>
      <div className="flex h-40 gap-3">
        <div
          aria-hidden
          className="flex w-12 shrink-0 flex-col justify-between text-right text-xs text-muted-foreground tabular-nums"
        >
          <span className="-translate-y-1/2">{props.format(top)}</span>
          <span>{props.format(top / 2)}</span>
          <span className="translate-y-1/2">{props.format(0)}</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div aria-hidden className="absolute inset-x-0 top-0 border-t border-dashed" />
          <div aria-hidden className="absolute inset-x-0 top-1/2 border-t border-dashed" />
          <div aria-hidden className="absolute inset-x-0 bottom-0 border-t" />
          <div className="absolute inset-0 flex gap-1">
            {props.bars.map((bar) => (
              <Tooltip key={bar.key}>
                <TooltipTrigger render={<div className="min-w-0 flex-1 rounded-sm px-px hover:bg-muted/60" />}>
                  <Column bar={bar} series={props.series} top={top} />
                </TooltipTrigger>
                <TooltipContent>
                  <BarDetail bar={bar} series={props.series} format={props.format} />
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      </div>
      <div aria-hidden className="flex gap-3 text-xs text-muted-foreground tabular-nums">
        <span className="w-12 shrink-0" />
        <span className="flex min-w-0 flex-1 justify-between">
          <span>{props.bars.at(0)?.label}</span>
          <span>{props.bars.at(-1)?.label}</span>
        </span>
      </div>
    </figure>
  )
}

export function ChartLegend(props: { series: ReadonlyArray<BarSeries>; totals?: ReadonlyArray<string> | undefined }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {props.series.map((series, index) => (
        <li key={series.label} className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-sm", series.swatch)} />
          {series.label}
          {props.totals?.[index] ? (
            <span className="font-medium text-foreground tabular-nums">{props.totals[index]}</span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
