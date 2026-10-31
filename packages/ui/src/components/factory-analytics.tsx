import { Menu } from "@base-ui/react/menu"
import { Tabs } from "@base-ui/react/tabs"
import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "cn"
import { useIsMobile } from "#hooks/use-mobile"
import {
  PERIODS,
  SPEND_STAGES,
  TIME_STAGES,
  contributionGrid,
  needsYou,
  periodRange,
  summarize,
  totalCost,
  type Analytics,
  type GridCell,
  type NeedsYouItem,
  type PeriodId,
  type PeriodSummary,
} from "../lib/factory/analytics.js"
import {
  formatCompactUsd,
  formatCount,
  formatLongDay,
  formatShortDuration,
  formatTokens,
  formatUsd,
} from "../lib/factory/format.js"
import { addDays, startOfMonth } from "../lib/factory/time.js"
import type { FactoryWorld } from "../lib/factory/types.js"

const EMBEDDED_NEEDS = 3
const SENTENCE =
  "w-max whitespace-nowrap text-[40px] leading-[52px] tracking-[-0.025em] text-[rgb(255_255_255/48%)] [font-variation-settings:'wght'_510] font-[510]"
const COMPACT_SENTENCE =
  "text-[26px] leading-[36px] tracking-[-0.02em] text-[rgb(255_255_255/48%)] [font-variation-settings:'wght'_510] font-[510] text-balance"
const COMPACT_WEEKS = 16
const ICON = "mr-[0.24em] ml-[0.03em] inline-block h-[0.6em] w-auto align-[-0.06em]"

function anchorOf(column: number, weeks: number) {
  if (column > weeks - 8) return "end"
  if (column < 8) return "start"
  return "middle"
}

export function FactoryAnalytics({ world, analytics }: { world: FactoryWorld; analytics: Analytics }) {
  const compact = useIsMobile()
  const [period, setPeriod] = useState<PeriodId>("week")
  const range = periodRange(period, analytics)
  const summary = summarize(analytics, range.from, range.to)
  const previousFrom = range.previous?.from
  const previousTo = range.previous?.to
  const previous = previousFrom && previousTo ? summarize(analytics, previousFrom, previousTo) : undefined
  const items = needsYou(world, analytics)
  const cost = SPEND_STAGES.reduce((sum, stage) => sum + summary.cost[stage], 0)
  const first = (
    <>
      Ren shipped <Figure icon={<ShippedIcon />}>{plural(summary.prs, "pull request")}</Figure>, triaged{" "}
      <Figure icon={<TriagedIcon />}>{plural(summary.tickets, "ticket")}</Figure>
    </>
  )
  const second = (
    <>
      and ran <Figure icon={<QaIcon />}>{plural(summary.qaPasses, "QA pass", "QA passes")}</Figure>{" "}
      <span className="whitespace-nowrap">
        <PeriodMenu value={period} onChange={setPeriod} />.
      </span>{" "}
      It cost <Figure icon={<CostIcon />}>{formatUsd(cost)}</Figure>.
    </>
  )

  const frame = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const outer = frame.current
    const inner = content.current
    if (!outer || !inner) return
    if (compact) {
      inner.style.zoom = ""
      return
    }
    const fit = () => {
      inner.style.zoom = "1"
      const scale = Math.min(1, outer.clientWidth / inner.offsetWidth, outer.clientHeight / inner.offsetHeight)
      inner.style.zoom = String(scale)
    }
    fit()
    let raf = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(fit)
    })
    observer.observe(outer)
    observer.observe(inner)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [compact])

  return (
    <div ref={frame} className={cn("factory", !compact && "flex h-full items-center justify-center overflow-hidden")}>
      <div
        ref={content}
        className={cn(
          "flex flex-col items-center px-6",
          compact ? "w-full items-stretch gap-8 px-4 py-6" : "w-[1108px] shrink-0 gap-[40px] py-[40px]",
        )}
      >
        {compact ? (
          <p className={COMPACT_SENTENCE}>
            {first} {second}
          </p>
        ) : (
          <FitSentence>
            <div className={SENTENCE}>{first}</div>
            <div className={SENTENCE}>{second}</div>
          </FitSentence>
        )}

        <ActivityGrid analytics={analytics} weeks={compact ? COMPACT_WEEKS : 52} />

        <div
          className={cn(
            "grid items-stretch",
            compact ? "w-full grid-cols-1 gap-8" : "w-[1060px] grid-cols-2 gap-[56px]",
          )}
        >
          <NeedsYou items={items.slice(0, EMBEDDED_NEEDS)} />
          <FactoryTabs summary={summary} previous={previous} compact={compact} />
        </div>
      </div>
    </div>
  )
}

function FitSentence({ children }: { children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null)
  const sentence = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const outer = frame.current
    const inner = sentence.current
    if (!outer || !inner) return
    const fit = () => {
      inner.style.zoom = "1"
      const natural = Math.max(...Array.from(inner.children, (line) => line.scrollWidth))
      inner.style.zoom = String(Math.min(1, outer.clientWidth / Math.max(natural, 1)))
    }
    fit()
    let raf = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(fit)
    })
    observer.observe(outer)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  })
  return (
    <div ref={frame} className="w-full max-w-[1040px]">
      <div ref={sentence} className="flex w-max flex-col gap-[2px]">
        {children}
      </div>
    </div>
  )
}

function plural(value: number, singular: string, many = `${singular}s`) {
  const count = Math.round(value)
  return `${formatCount(count)} ${count === 1 ? singular : many}`
}

function Figure({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="tnum whitespace-nowrap text-(--f-text-1)">
      {icon}
      {children}
    </span>
  )
}

function ShippedIcon() {
  return (
    <svg viewBox="4 2 16 20" aria-hidden className={ICON}>
      <path
        d="M7 6v12M17 6v2.5a4.5 4.5 0 0 1-4.5 4.5h-1A4.5 4.5 0 0 0 7 17.5"
        fill="none"
        stroke="var(--f-plan)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="7" cy="5" r="3" fill="var(--f-plan)" />
      <circle cx="7" cy="19" r="3" fill="var(--f-plan)" />
      <circle cx="17" cy="5" r="3" fill="var(--f-plan)" />
    </svg>
  )
}

function TriagedIcon() {
  return (
    <svg viewBox="2 2 20 20" overflow="visible" aria-hidden className={ICON}>
      <circle cx="12" cy="12" r="8.75" fill="none" stroke="var(--f-build)" strokeWidth="2.25" />
      <path d="M12 6.5a5.5 5.5 0 0 1 0 11Z" fill="var(--f-build)" />
    </svg>
  )
}

function QaIcon() {
  return (
    <svg viewBox="2 2 20 20" overflow="visible" aria-hidden className={ICON}>
      <circle cx="12" cy="12" r="10" fill="var(--f-qa)" />
      <path
        d="m7.8 12.3 2.9 2.9 5.5-6"
        fill="none"
        stroke="var(--f-bg-primary)"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CostIcon() {
  return (
    <svg viewBox="2 2 20 20" overflow="visible" aria-hidden className={ICON}>
      <circle cx="12" cy="12" r="10" fill="var(--f-amber)" />
      <path
        d="M14.6 9.2c-.4-.8-1.4-1.3-2.6-1.3-1.5 0-2.6.8-2.6 1.9 0 2.6 5.3 1.3 5.3 3.9 0 1.1-1.1 2-2.7 2-1.3 0-2.3-.5-2.8-1.4M12 6.3v1.6M12 16v1.7"
        fill="none"
        stroke="var(--f-bg-primary)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PeriodMenu({ value, onChange }: { value: PeriodId; onChange: (value: PeriodId) => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger className="group inline-flex items-baseline gap-[0.14em] rounded-[6px] font-[inherit] text-[1em] leading-[inherit] tracking-[inherit] text-inherit transition-colors duration-150 outline-none hover:text-(--f-text-1) focus-visible:ring-2 focus-visible:ring-(--f-accent) focus-visible:ring-offset-4 focus-visible:ring-offset-(--f-bg-primary) data-popup-open:text-(--f-text-1)">
        <span className="underline decoration-[rgb(255_255_255/20%)] decoration-[1.5px] underline-offset-[0.18em] transition-[text-decoration-color] duration-150 group-hover:decoration-[rgb(255_255_255/60%)] group-data-popup-open:decoration-[rgb(255_255_255/60%)]">
          {PERIODS.find((period) => period.id === value)?.phrase}
        </span>
        <svg
          viewBox="5 8 14 8"
          overflow="visible"
          aria-hidden
          className="h-[0.2em] w-[0.35em] shrink-0 self-center transition-[color,transform] duration-150 ease-out group-hover:text-(--f-text-1) group-data-popup-open:rotate-180 group-data-popup-open:text-(--f-text-1)"
        >
          <path
            d="m6 9 6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={8} className="z-50 factory">
          <Menu.Popup
            // oxlint-disable-next-line ren/require-companion-class -- focus moves to the items, which mark it with data-highlighted
            className="flex w-[220px] f-menu flex-col gap-[2px] rounded-xl border border-solid border-[rgb(255_255_255/8%)] bg-(--f-bg-secondary) p-[6px] shadow-[#00000080_0px_12px_32px] outline-none"
          >
            <Menu.RadioGroup
              value={value}
              onValueChange={(next) => {
                const period = PERIODS.find((option) => option.id === next)
                if (period) onChange(period.id)
              }}
            >
              {PERIODS.map((period) => (
                <PeriodOption key={period.id} id={period.id} label={period.label} />
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

function PeriodOption({ id, label }: { id: PeriodId; label: string }) {
  return (
    <Menu.RadioItem
      value={id}
      closeOnClick
      // oxlint-disable-next-line ren/require-companion-class -- Base UI marks the keyboard-focused item with data-highlighted
      className="group flex h-[34px] shrink-0 cursor-default items-center justify-between rounded-lg px-[10px] t-sm text-(--f-text-2) outline-none data-highlighted:bg-[rgb(255_255_255/4%)] data-checked:bg-[rgb(255_255_255/6%)] data-checked:text-(--f-text-1)"
    >
      <span className="w-reg group-data-checked:w-med">{label}</span>
      <Menu.RadioItemIndicator>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
          <path
            d="m5 12.5 4.5 4.5L19 7.5"
            fill="none"
            stroke="var(--f-text-1)"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Menu.RadioItemIndicator>
    </Menu.RadioItem>
  )
}

const COL = (1040 - 14) / 51
const ROW = (127.9 - 10) / 6

function cellColor(cell: GridCell, levels: { low: number; mid: number; high: number }) {
  const prs = cell.stat?.prs ?? 0
  if (cell.future || cell.beforeStart || prs === 0) return "var(--f-grid-0)"
  if (prs <= levels.low) return "var(--f-grid-1)"
  if (prs <= levels.mid) return "var(--f-grid-2)"
  if (prs <= levels.high) return "var(--f-grid-3)"
  return "var(--f-grid-4)"
}

function ActivityGrid({ analytics, weeks }: { analytics: Analytics; weeks: number }) {
  const grid = contributionGrid(analytics)
  const skip = 52 - weeks
  const cells = grid.cells.filter((cell) => cell.col >= skip)
  const startedCol = grid.startedCol - skip
  const compact = weeks < 52
  const gridWidth = (weeks - 1) * COL + 14
  const [hovered, setHovered] = useState<GridCell | null>(null)
  const monthStart = startOfMonth(analytics.now)
  const daysInMonth = (startOfMonth(addDays(monthStart, 32)) - monthStart) / 86_400_000
  const lineX = startedCol * COL - 3

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const col = Math.round((x - 7) / COL)
    const row = Math.round((y - 17) / ROW)
    const cell = col >= 0 && col < weeks && row >= 0 && row < 7 ? cells[col * 7 + row] : undefined
    setHovered(cell && !cell.future ? cell : null)
  }

  return (
    <div className="relative flex flex-col gap-4" style={{ width: compact ? "100%" : gridWidth }}>
      <svg
        width={compact ? "100%" : gridWidth}
        height={compact ? undefined : "173.9"}
        viewBox={`0 0 ${gridWidth} 173.9`}
        className={cn("shrink-0", compact && "h-auto")}
        onPointerMove={compact ? undefined : onMove}
        onPointerLeave={() => setHovered(null)}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an inline SVG chart takes role="img" to carry its label
        role="img"
        aria-label="Pull requests merged per day over the last year"
      >
        {cells.map((cell) => (
          <rect
            key={cell.day}
            x={(cell.col - skip) * COL}
            y={10 + cell.row * ROW}
            width="14"
            height="14"
            rx="3.5"
            fill={cellColor(cell, grid.levels)}
          />
        ))}
        {hovered ? (
          <rect
            x={(hovered.col - skip) * COL - 1.5}
            y={10 + hovered.row * ROW - 1.5}
            width="17"
            height="17"
            rx="4.5"
            fill="none"
            stroke="var(--f-text-1)"
            strokeWidth="1.5"
          />
        ) : null}
        {startedCol > 0 && startedCol < weeks ? (
          <>
            <line
              x1={lineX}
              x2={lineX}
              y1="0"
              y2="151.9"
              stroke="var(--f-success)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray="3 4"
            />
            <text
              x={lineX}
              y="168.9"
              textAnchor={anchorOf(startedCol, weeks)}
              fontFamily="SF Pro Variable, sans-serif"
              fontSize="12"
              fontWeight="500"
              fill="var(--f-success)"
            >
              Ren started working
            </text>
          </>
        ) : null}
      </svg>
      <GridTooltip
        cell={hovered}
        x={hovered ? (hovered.col - skip) * COL : 0}
        gridWidth={gridWidth}
        dailyBudget={analytics.monthlyBudget / daysInMonth}
      />
    </div>
  )
}

function GridTooltip({
  cell,
  x,
  gridWidth,
  dailyBudget,
}: {
  cell: GridCell | null
  x: number
  gridWidth: number
  dailyBudget: number
}) {
  const y = cell ? 10 + cell.row * ROW : 0
  const anchorRight = Math.min(gridWidth, Math.max(232, x + 7 + 16))
  const cost = cell?.stat ? totalCost(cell.stat) : 0
  return (
    <div
      aria-hidden={!cell}
      className={cn(
        "pointer-events-none absolute flex w-max min-w-[232px] flex-col gap-[2px] rounded-[8px] bg-(--f-text-1) px-3 py-2 whitespace-nowrap shadow-[#00000080_0px_8px_24px] transition-opacity duration-125 ease-[cubic-bezier(0.23,1,0.32,1)]",
        cell ? "opacity-100" : "opacity-0 duration-100",
      )}
      style={{ right: gridWidth - anchorRight, top: Math.max(-48, y - 56) }}
    >
      {cell ? (
        <>
          <div className="t-xs w-semi text-(--f-bg-tertiary)">{formatLongDay(cell.day)}</div>
          {cell.beforeStart ? (
            <div className="t-xs text-(--f-light-text-2)">Before Ren started working</div>
          ) : (
            <div className="flex gap-[6px]">
              <div className="t-xs w-semi text-(--f-light-success)">
                {plural(cell.stat?.prs ?? 0, "PR merged", "PRs merged")}
              </div>
              <div className="t-xs text-(--f-light-text-2)">· {formatUsd(cost)}</div>
              {cost > dailyBudget ? <div className="t-xs text-(--f-light-warning)">over budget</div> : null}
            </div>
          )}
          <div
            className="absolute bottom-[-4px] size-[10px] rotate-45 rounded-[2px] bg-(--f-text-1)"
            style={{ right: anchorRight - (x + 7) - 5 }}
          />
        </>
      ) : null}
    </div>
  )
}

const NEEDS_VISIBLE = 6

function NeedsYou({ items }: { items: NeedsYouItem[] }) {
  const list = useRef<HTMLDivElement>(null)
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined)
  const [edges, setEdges] = useState({ top: false, bottom: false })

  const updateEdges = () => {
    const element = list.current
    if (!element) return
    setEdges({
      top: element.scrollTop > 1,
      bottom: element.scrollTop + element.clientHeight < element.scrollHeight - 1,
    })
  }

  useLayoutEffect(() => {
    const element = list.current
    if (!element) return
    const rows = [...element.children].filter((row) => row instanceof HTMLElement)
    const first = rows.at(0)
    const last = rows.at(Math.min(rows.length, NEEDS_VISIBLE) - 1)
    setMaxHeight(
      rows.length > NEEDS_VISIBLE && first && last ? last.offsetTop + last.offsetHeight - first.offsetTop : undefined,
    )
    updateEdges()
  }, [items])

  const mask =
    edges.top || edges.bottom
      ? `linear-gradient(to bottom, ${edges.top ? "transparent" : "black"} 0, black 32px, black calc(100% - 32px), ${edges.bottom ? "transparent" : "black"} 100%)`
      : undefined

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex h-7 shrink-0 items-center gap-2 px-[10px]">
        <div className="t-13 text-(--f-text-2)">Needs you</div>
        <div className="t-xs text-(--f-border-2)">{items.length}</div>
      </div>
      <div
        ref={list}
        onScroll={updateEdges}
        className="relative f-scroll grid grow auto-rows-fr overflow-y-auto overscroll-contain"
        style={{ maxHeight, maskImage: mask, WebkitMaskImage: mask }}
      >
        {items.map((item) => (
          <a
            key={item.id}
            href={item.href}
            className="group flex w-full items-center gap-[14px] rounded-[10px] p-[10px] transition-colors duration-150 outline-none hover:bg-[rgb(255_255_255/4%)] focus-visible:bg-[rgb(255_255_255/4%)]"
          >
            <div className="flex size-4 shrink-0">
              <NeedsIcon kind={item.icon} />
            </div>
            <div className="flex grow basis-0 flex-col gap-[2px]">
              <div className="t-sm font-medium text-(--f-text-1)">{item.title}</div>
              <div className="t-13 text-(--f-text-2)">{item.detail}</div>
            </div>
            <div className="flex size-4 shrink-0 items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                <path
                  d="M5 12h14"
                  fill="none"
                  stroke="var(--f-text-1)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="m13 6 6 6-6 6"
                  fill="none"
                  stroke="var(--f-text-1)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}

const NEEDS_ICONS: Record<NeedsYouItem["icon"], { color: string; glyph: ReactNode }> = {
  budget: {
    color: "var(--f-amber)",
    glyph: (
      <path
        d="M9.9 6.1c-.3-.6-1-.9-1.9-.9-1 0-1.8.5-1.8 1.3 0 1.8 3.7.9 3.7 2.7 0 .8-.8 1.4-1.9 1.4-.9 0-1.6-.4-1.9-1M8 4v1.1M8 10.6v1.2"
        fill="none"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    ),
  },
  incident: {
    color: "var(--f-red)",
    glyph: (
      <path
        d="M3.8 8.4h1.9l1.1-2.4 1.9 4.4 1.1-2h2.4"
        fill="none"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  finding: {
    color: "var(--f-monitor)",
    glyph: (
      <path
        d="M3.8 8.4h1.9l1.1-2.4 1.9 4.4 1.1-2h2.4"
        fill="none"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  hallucination: {
    color: "var(--f-plan)",
    glyph: (
      <path
        d="M8 4.3c.3 1.9 1.1 2.8 3 3.2-1.9.4-2.7 1.3-3 3.2-.3-1.9-1.1-2.8-3-3.2 1.9-.4 2.7-1.3 3-3.2Z"
        stroke="none"
      />
    ),
  },
  approval: {
    color: "var(--f-plan)",
    glyph: (
      <path d="m5.2 8.2 1.9 1.9 3.7-4" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  merge: {
    color: "var(--f-build)",
    glyph: (
      <path
        d="M6 4.8v6.4M6 6.2a2.4 2.4 0 0 0 2.4 2.4H10M10 8.6a.9.9 0 1 0 0 .01"
        fill="none"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  blocked: {
    color: "var(--f-amber)",
    glyph: <path d="M8 4.6v4.1M8 11.1v.1" fill="none" strokeWidth="1.6" strokeLinecap="round" />,
  },
  loop: {
    color: "var(--f-review)",
    glyph: (
      <path
        d="M10.8 6.4A3.1 3.1 0 0 0 5.2 6.8M5.2 9.6a3.1 3.1 0 0 0 5.6.4M10.9 4.6v1.9H9M5.1 11.4V9.5H7"
        fill="none"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  spend: {
    color: "var(--f-red)",
    glyph: (
      <path
        d="M4.6 10.4 7 8l1.6 1.6 2.8-3M9.3 6.6h2.1v2.1"
        fill="none"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  backlog: {
    color: "var(--f-release)",
    glyph: <path d="M8 5v3.2l2 1.3" fill="none" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />,
  },
}

function NeedsIcon({ kind }: { kind: NeedsYouItem["icon"] }) {
  const icon = NEEDS_ICONS[kind]
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="7" fill={icon.color} />
      <g stroke="#1c1c1c" fill="#1c1c1c">
        {icon.glyph}
      </g>
    </svg>
  )
}

const TABS = ["Time", "Cost", "Tokens", "Runs"] as const
type Tab = (typeof TABS)[number]

const SPEND_LEGEND = [
  { key: "plan", label: "Plan", color: "var(--f-plan)" },
  { key: "build", label: "Build", color: "var(--f-build)" },
  { key: "review", label: "Review", color: "var(--f-review)" },
  { key: "qa", label: "QA", color: "var(--f-qa)" },
  { key: "monitoring", label: "Monitoring", color: "var(--f-monitor)" },
] as const

const TIME_LEGEND = [
  { key: "plan", label: "Plan", color: "var(--f-plan)" },
  { key: "build", label: "Build", color: "var(--f-build)" },
  { key: "review", label: "Review", color: "var(--f-review)" },
  { key: "qa", label: "QA", color: "var(--f-qa)" },
  { key: "human", label: "Human", color: "var(--f-human)" },
] as const

type Delta = { text: string; tone: "success" | "warning" }

type Panel = {
  title: string
  value: string
  delta?: Delta | undefined
  note: string
  segments: Array<{ key: string; label: string; color: string; weight: number; value: string }>
}

const SPEND_PANELS = {
  Cost: {
    field: "cost",
    title: "Cost by stage",
    format: formatCompactUsd,
    total: formatUsd,
    perPr: (value: number) => `${formatUsd(value)} per merged PR`,
    upIsGood: false,
  },
  Tokens: {
    field: "tokens",
    title: "Tokens by stage",
    format: formatTokens,
    total: formatTokens,
    perPr: (value: number) => `${formatTokens(value)} per merged PR`,
    upIsGood: false,
  },
  Runs: {
    field: "runs",
    title: "Runs by stage",
    format: (value: number) => formatCount(value),
    total: (value: number) => formatCount(value),
    perPr: (value: number) => `${value.toFixed(1)} per merged PR`,
    upIsGood: true,
  },
} as const satisfies Record<
  Exclude<Tab, "Time">,
  {
    field: "cost" | "tokens" | "runs"
    title: string
    format: (value: number) => string
    total: (value: number) => string
    perPr: (value: number) => string
    upIsGood: boolean
  }
>

function delta(
  current: number,
  before: number | undefined,
  format: (n: number) => string,
  direction: { upIsGood: boolean },
): Delta | undefined {
  if (!before || before <= 0) return undefined
  const diff = current - before
  const text = format(Math.abs(diff))
  if (/^\$?0(\.00)?[mk]?$|^0m$/.test(text)) return undefined
  const up = diff > 0
  return { text: `${up ? "↑" : "↓"} ${text}`, tone: up === direction.upIsGood ? "success" : "warning" }
}

function panelFor(tab: Tab, summary: PeriodSummary, previous: PeriodSummary | undefined): Panel {
  if (tab === "Time") {
    const avg = (s: PeriodSummary, key: (typeof TIME_STAGES)[number]) => s.stageMs[key] / Math.max(1, s.prs)
    const total = TIME_STAGES.reduce((sum, key) => sum + avg(summary, key), 0)
    const before = previous ? TIME_STAGES.reduce((sum, key) => sum + avg(previous, key), 0) : undefined
    return {
      title: "Time in each stage",
      value: formatShortDuration(total),
      delta: delta(total, before, formatShortDuration, { upIsGood: false }),
      note: "avg per ticket",
      segments: TIME_LEGEND.map((item) => ({
        key: item.key,
        label: item.label,
        color: item.color,
        weight: avg(summary, item.key),
        value: formatTwoDigit(avg(summary, item.key)),
      })),
    }
  }
  const panel = SPEND_PANELS[tab]
  const sum = (s: PeriodSummary) => SPEND_STAGES.reduce((total, key) => total + s[panel.field][key], 0)
  const total = sum(summary)
  return {
    title: panel.title,
    value: panel.total(total),
    delta: delta(total, previous ? sum(previous) : undefined, panel.format, { upIsGood: panel.upIsGood }),
    note: panel.perPr(total / Math.max(1, summary.prs)),
    segments: SPEND_LEGEND.map((item) => ({
      key: item.key,
      label: item.label,
      color: item.color,
      weight: summary[panel.field][item.key],
      value: panel.format(summary[panel.field][item.key]),
    })),
  }
}

function formatTwoDigit(ms: number) {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
}

function FactoryTabs({
  summary,
  previous,
  compact = false,
}: {
  summary: PeriodSummary
  previous: PeriodSummary | undefined
  compact?: boolean
}) {
  const [tab, setTab] = useState<Tab>("Time")
  const panel = panelFor(tab, summary, previous)
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Tabs.Root value={tab} onValueChange={(value: Tab) => setTab(value)} className="flex min-w-0 flex-col">
        <Tabs.List
          aria-label="Factory breakdown"
          className="relative isolate flex h-7 max-w-full justify-start gap-1 overflow-x-auto overscroll-contain"
        >
          {TABS.map((name) => (
            <Tabs.Tab
              key={name}
              value={name}
              className="inline-flex h-7 flex-none items-center justify-center rounded-[8px] px-3 text-xs font-normal whitespace-nowrap text-(--f-text-2) outline-none hover:bg-(--f-fill-1) hover:text-(--f-text-1) focus-visible:ring-2 focus-visible:ring-(--f-accent) data-active:bg-(--f-fill-2) data-active:font-medium data-active:text-(--f-text-1)"
            >
              {name}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs.Root>
      <div className="flex min-h-[208px] grow flex-col rounded-xl bg-[rgb(255_255_255/3%)] p-5">
        <div key={tab} className="flex grow f-fade-in flex-col justify-between gap-6">
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <div className="text-[13px] leading-[17px] w-reg text-(--f-text-2)">{panel.title}</div>
              <div className="flex items-baseline gap-[10px]">
                <div className="tnum text-[34px] leading-[40px] w-semi tracking-[-0.02em] text-(--f-text-1)">
                  {panel.value}
                </div>
                {panel.delta ? (
                  <div
                    className={cn(
                      "tnum text-[13px] leading-[17px] w-med",
                      panel.delta.tone === "success" ? "text-(--f-success)" : "text-(--f-warning)",
                    )}
                  >
                    {panel.delta.text}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="t-xs w-reg text-(--f-border-2)">{panel.note}</div>
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex h-2.5 shrink-0 gap-[3px]">
              {panel.segments.map((segment) => (
                <div
                  key={segment.key}
                  className="h-2.5 basis-0 rounded-[3px]"
                  style={{ flexGrow: Math.max(segment.weight, 0.0001), background: segment.color }}
                />
              ))}
            </div>
            <div className={cn("flex flex-wrap gap-y-1", compact ? "gap-x-4" : "justify-between gap-x-2")}>
              {panel.segments.map((segment) => (
                <div key={segment.key} className="flex shrink-0 items-center gap-[6px] whitespace-nowrap">
                  <div className="size-2 shrink-0 rounded-[2px]" style={{ background: segment.color }} />
                  <div className="w-max t-xs w-reg text-(--f-text-2)">{segment.label}</div>
                  <div className="w-max tnum t-xs w-med text-(--f-text-1)">{segment.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
