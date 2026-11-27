import { useState, type ReactNode } from "react"
import type { Infra } from "@ren/schema/infra"
import { IconArrowBackUp, IconCheck, IconPlus } from "@tabler/icons-react"
import { cn } from "cn"
import { Badge } from "@ren/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ren/ui/tooltip"
import { PanZoom } from "../../components/pan-zoom.js"
import { FactoryLine } from "./factory-line.js"

interface Point {
  readonly x: number
  readonly y: number
}

const station = { minWidth: 96, maxWidth: 200, charWidth: 7.6, chrome: 28, height: 44, rowGap: 16 }
const spacing = { gap: 64, lane: 28, pad: 16, labelRoom: 14, spread: 8 }

const runsOf = (each: FactoryLine.Station) => (each.maxRuns ? `max ${each.maxRuns} runs` : "")
const reachOf = (each: FactoryLine.Station) => (each.toAnyone ? "any agent" : "")
const details = (parts: ReadonlyArray<string>) => parts.filter((part) => part !== "").join(" · ")

const clamp = (low: number, high: number, value: number) => Math.max(low, Math.min(high, value))
const crisp = (value: number) => Math.round(value) + 0.5

const corner = (from: Point, to: Point, laneY: number) =>
  `M ${crisp(from.x)} ${from.y} V ${crisp(laneY)} H ${crisp(to.x)} V ${to.y}`

const elbow = (a: Point, b: Point) => {
  if (Math.abs(a.y - b.y) < 1) return `M ${a.x} ${crisp(a.y)} H ${b.x}`
  const middle = crisp((a.x + b.x) / 2)
  return `M ${a.x} ${crisp(a.y)} H ${middle} V ${crisp(b.y)} H ${b.x}`
}

const arrowRight = (tip: Point) =>
  `M ${tip.x} ${crisp(tip.y)} L ${tip.x - 6} ${crisp(tip.y) - 3.5} L ${tip.x - 6} ${crisp(tip.y) + 3.5} Z`

const arrowVertical = (tip: Point, direction: "up" | "down") => {
  const base = tip.y + (direction === "up" ? 6 : -6)
  return `M ${crisp(tip.x)} ${tip.y} L ${crisp(tip.x) - 3.5} ${base} L ${crisp(tip.x) + 3.5} ${base} Z`
}

const place = (line: FactoryLine.Line) => {
  const boxWidth = clamp(
    station.minWidth,
    station.maxWidth,
    Math.max(
      0,
      ...line.stations.map(
        (each) =>
          station.chrome +
          Math.max(each.name.length, details([runsOf(each), reachOf(each)]).length * 0.8) * station.charWidth,
      ),
    ),
  )
  const left = (column: number) => spacing.pad + (column + 1) * (boxWidth + spacing.gap)
  const block = line.rows * station.height + (line.rows - 1) * station.rowGap
  const lineY = spacing.pad + spacing.labelRoom + line.lanesAbove * spacing.lane + block / 2
  const centers = new Map(
    line.stations.map((each) => [
      each.name,
      {
        x: left(each.column) + boxWidth / 2,
        y: lineY + (each.row - (each.rows - 1) / 2) * (station.height + station.rowGap),
      },
    ]),
  )
  const halves = new Map(line.stations.map((each) => [each.name, boxWidth / 2]))
  const start = { x: spacing.pad + boxWidth / 2, y: lineY }
  const finish = { x: left(line.columns - 1) + boxWidth / 2, y: lineY }
  const at = (name: string | undefined) => (name === undefined ? finish : (centers.get(name) ?? finish))
  const half = (name: string | undefined) => (name === undefined ? boxWidth / 2 : (halves.get(name) ?? 0))
  const routes = line.routes.map((route) => {
    const from = at(route.from)
    const to = at(route.to)
    if (route.kind === "next") {
      const a = { x: from.x + half(route.from), y: from.y }
      const b = { x: to.x - half(route.to), y: to.y }
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      return {
        route,
        d: elbow(a, b),
        arrow: arrowRight(b),
        label: middle,
        tag: { x: middle.x, y: Math.min(a.y, b.y) - station.height / 2 - 12 },
      }
    }
    const isBack = route.kind === "back"
    const isBelow = route.side === "below"
    const sign = isBelow ? 1 : -1
    const offset = (route.lane - 1) * spacing.spread
    const fromOffset = clamp(0, half(route.from) - 10, offset)
    const toOffset = isBack ? 0 : clamp(0, half(route.to) - 10, offset)
    const a = { x: from.x + (isBack ? fromOffset : -fromOffset), y: from.y + sign * (station.height / 2) }
    const b = { x: to.x + (isBack ? -toOffset : toOffset), y: to.y + sign * (station.height / 2 + 1) }
    const laneY = isBelow
      ? lineY + block / 2 + route.lane * spacing.lane
      : lineY - block / 2 - route.lane * spacing.lane
    return {
      route,
      d: corner(a, b, laneY),
      arrow: arrowVertical(b, isBelow ? "up" : "down"),
      label: { x: (a.x + b.x) / 2, y: laneY },
      tag: { x: (a.x + b.x) / 2, y: laneY },
    }
  })
  return {
    width: left(line.columns - 1) + boxWidth + spacing.pad,
    height: lineY + block / 2 + line.lanesBelow * spacing.lane + spacing.labelRoom + spacing.pad,
    boxWidth,
    centers,
    start,
    finish,
    routes,
    starts: line.stations
      .filter((each) => each.column === 0)
      .map((each) => {
        const b = { x: at(each.name).x - half(each.name), y: at(each.name).y }
        return { name: each.name, d: elbow({ x: start.x + boxWidth / 2, y: start.y }, b), arrow: arrowRight(b) }
      }),
  }
}

type Placed = ReturnType<typeof place>

const limitOf = (route: FactoryLine.Route) =>
  [
    ...(route.max ? [`max ${route.max}`] : []),
    ...(route.fallback ? [`after ${route.fallback.max}× to ${route.fallback.agent}`] : []),
    ...(route.start === "new" && route.kind !== "next" ? ["new chat"] : []),
  ].join(" · ")

const dashOf = (route: FactoryLine.Route) => {
  if (route.isFallbackOnly) return "1 3"
  return route.kind === "back" ? "4 3" : undefined
}

const routeKey = (route: FactoryLine.Route) => `${route.from}>${route.to ?? "finish"}`

const isPair = (a: FactoryLine.Route, b: FactoryLine.Route) =>
  a.from === b.from && (a.fallback?.agent === b.to || b.fallback?.agent === a.to)

const isActive = (line: FactoryLine.Line, route: FactoryLine.Route, focus: string | undefined) =>
  route.from === focus ||
  routeKey(route) === focus ||
  line.routes.some((other) => routeKey(other) === focus && isPair(route, other))

const isNear = (line: FactoryLine.Line, route: FactoryLine.Route, focus: string | undefined) =>
  focus === undefined || isActive(line, route, focus)

const isLit = (line: FactoryLine.Line, name: string, focus: string | undefined) =>
  focus === undefined ||
  focus === name ||
  line.routes.some((route) => isActive(line, route, focus) && (route.from === name || route.to === name))

function Positioned(props: { at: Point; className?: string | undefined; children: ReactNode }) {
  return (
    <div
      className={cn("absolute -translate-x-1/2 -translate-y-1/2", props.className)}
      // oxlint-disable-next-line react/forbid-dom-props -- each part sits where the layout placed it
      style={{ left: props.at.x, top: props.at.y }}
    >
      {props.children}
    </div>
  )
}

function Tag(props: { at: Point; children: ReactNode }) {
  return (
    <Positioned at={props.at} className="pointer-events-none z-10">
      <span className="flex items-center gap-1 rounded-xs border border-foreground/20 bg-card px-1.5 py-px font-mono text-xs whitespace-nowrap">
        {props.children}
      </span>
    </Positioned>
  )
}

function Terminal(props: { at: Point; width: number; filled: boolean; children: ReactNode }) {
  return (
    <Positioned at={props.at}>
      <span
        className={cn(
          "flex items-center justify-center gap-1.5 rounded-sm border border-foreground text-sm font-medium",
          props.filled ? "bg-foreground text-background" : "bg-card",
        )}
        // oxlint-disable-next-line react/forbid-dom-props -- the start and the finish are the size of an agent
        style={{ width: props.width, height: station.height }}
      >
        {props.children}
      </span>
    </Positioned>
  )
}

function Routes(props: {
  line: FactoryLine.Line
  placed: Placed
  focus: string | undefined
  onFocus: (focus: string | undefined) => void
}) {
  return (
    <svg
      className="absolute inset-0 text-foreground"
      width={props.placed.width}
      height={props.placed.height}
      aria-hidden
    >
      {props.placed.starts.map((start) => (
        <g key={start.name} className={cn("transition-opacity", props.focus !== undefined && "opacity-15")}>
          <path d={start.d} fill="none" stroke="currentColor" shapeRendering="crispEdges" />
          <path d={start.arrow} fill="currentColor" />
        </g>
      ))}
      {props.placed.routes.map((each) => {
        const near = isNear(props.line, each.route, props.focus)
        const isQuiet = each.route.kind === "back" || each.route.isFallbackOnly
        return (
          <g
            key={routeKey(each.route)}
            className={cn(
              "transition-opacity",
              isQuiet && (props.focus === undefined || !near) && "text-muted-foreground",
              !near && "opacity-15",
            )}
          >
            <path
              d={each.d}
              fill="none"
              stroke="currentColor"
              strokeDasharray={dashOf(each.route)}
              shapeRendering="crispEdges"
            />
            <path d={each.arrow} fill="currentColor" />
            <path
              d={each.d}
              fill="none"
              stroke="transparent"
              strokeWidth={12}
              pointerEvents="stroke"
              onPointerEnter={() => props.onFocus(routeKey(each.route))}
              onPointerLeave={() => props.onFocus(undefined)}
            />
          </g>
        )
      })}
    </svg>
  )
}

function Line(props: { line: FactoryLine.Line }) {
  const [focus, setFocus] = useState<string>()
  const placed = place(props.line)
  return (
    <PanZoom
      key={`${placed.width}x${placed.height}`}
      width={placed.width}
      height={placed.height}
      label="How tasks move between the agents"
      className="factory-grid"
    >
      <Routes line={props.line} placed={placed} focus={focus} onFocus={setFocus} />
      <Terminal at={placed.start} width={placed.boxWidth} filled={false}>
        Start
      </Terminal>
      {props.line.stations.map((each) => (
        <Positioned key={each.name} at={placed.centers.get(each.name) ?? placed.finish}>
          <div
            title={each.name}
            onPointerEnter={() => setFocus(each.name)}
            onPointerLeave={() => setFocus(undefined)}
            className={cn(
              "flex flex-col items-center justify-center rounded-sm border bg-card px-3 text-center transition-[opacity,border-color]",
              each.toAnyone && "border-dashed",
              focus === each.name ? "border-foreground" : "border-foreground/30",
              !isLit(props.line, each.name, focus) && "opacity-30",
            )}
            // oxlint-disable-next-line react/forbid-dom-props -- every station is as wide as the longest name needs
            style={{ width: placed.boxWidth, height: station.height }}
          >
            <span className="max-w-full truncate text-sm font-medium">{each.name}</span>
            {details([focus === each.name ? runsOf(each) : "", reachOf(each)]) ? (
              <span className="max-w-full truncate font-mono text-2xs text-muted-foreground">
                {details([focus === each.name ? runsOf(each) : "", reachOf(each)])}
              </span>
            ) : null}
          </div>
        </Positioned>
      ))}
      {props.line.hasFinish ? (
        <Terminal at={placed.finish} width={placed.boxWidth} filled>
          <IconCheck className="size-3.5" />
          Finish
        </Terminal>
      ) : null}
      {placed.routes
        .filter((each) => each.route.kind === "next" && each.route.start === "new")
        .map((each) => (
          <Positioned
            key={routeKey(each.route)}
            at={each.label}
            className={cn("transition-opacity", !isNear(props.line, each.route, focus) && "opacity-15")}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="flex size-4 items-center justify-center rounded-xs border border-foreground/40 bg-card" />
                }
              >
                <IconPlus className="size-2.5" />
              </TooltipTrigger>
              <TooltipContent>Starts a new chat</TooltipContent>
            </Tooltip>
          </Positioned>
        ))}
      {focus === undefined
        ? null
        : placed.routes
            .filter((each) => isActive(props.line, each.route, focus) && limitOf(each.route))
            .map((each) => (
              <Tag key={routeKey(each.route)} at={each.tag}>
                {each.route.kind === "back" ? <IconArrowBackUp className="size-3" /> : null}
                {limitOf(each.route)}
              </Tag>
            ))}
    </PanZoom>
  )
}

export function FactoryFlow(props: { declaration: Infra.FactoryDeclaration; className?: string | undefined }) {
  const line = FactoryLine.layout(props.declaration)
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", props.className)}>
      {line.stations.length > 0 ? (
        <Line line={line} />
      ) : (
        <p className="m-auto text-sm text-muted-foreground">
          No agent hands off to another yet. List who each agent hands off to under{" "}
          <code className="font-mono">to</code> in spec.yaml.
        </p>
      )}
      {line.loose.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
          Off the line, can hand off to any agent:
          {line.loose.map((each) => (
            <Badge key={each.name} variant="outline">
              {each.name}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}
