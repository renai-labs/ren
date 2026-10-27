import { Menu } from "@base-ui/react/menu"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { cn } from "../../lib/utils.js"
import { formatAgo, formatClock, formatDayLabel } from "../../lib/factory/format.js"
import { DAY, HOUR, startOfDay } from "../../lib/factory/time.js"
import { MenuCheck, Pause, Play, SmallChevronDown, StepBack, StepForward } from "./icons.js"
import { SNAP, SPEEDS, type Speed, type TimelineController } from "./use-timeline.js"

const RUBBER = 0.55
const DECELERATION = 0.998
const FLICK = 0.25

type TickKind = "day" | "noon" | "quarter"

const TICK_CLASS: Record<TickKind, string> = {
  day: "h-[10px] bg-(--f-border-2)",
  noon: "h-[6px] bg-[rgb(255_255_255/22%)]",
  quarter: "h-[3px] bg-[rgb(255_255_255/22%)]",
}

function rubber(distance: number, size: number) {
  return (1 - 1 / ((distance * RUBBER) / size + 1)) * size
}

function tickKind(t: number): TickKind {
  const hour = new Date(t).getHours()
  if (hour === 0) return "day"
  return hour === 12 ? "noon" : "quarter"
}

export function TimelineScrubber({
  timeline,
  now,
  compact = false,
}: {
  timeline: TimelineController
  now: number
  compact?: boolean
}) {
  const live = timeline.mode === "live"
  const running = timeline.mode === "playing" || live

  return (
    <div className="flex shrink-0 items-center gap-2 bg-(--f-bg-primary) px-3 py-[6px]">
      <ControlButton
        label={running ? "Pause" : "Play"}
        className="w-[28px] justify-center bg-(--f-fill-2)"
        onClick={timeline.togglePlay}
      >
        {running ? <Pause /> : <Play />}
      </ControlButton>

      <SpeedMenu speed={timeline.speed} onChange={timeline.setSpeed} />

      {compact ? (
        <div className="flex grow items-baseline justify-center gap-[6px]">
          <div className="tnum t-xs w-med text-(--f-text-2)">{formatDayLabel(timeline.at)}</div>
          <div className="tnum t-sm w-semi text-(--f-text-1)">{formatClock(timeline.at)}</div>
        </div>
      ) : null}

      <div
        className={cn(
          "flex h-8 grow overflow-clip rounded-lg transition-colors duration-150",
          timeline.scrubbing ? "bg-(--f-fill-2)" : "bg-(--f-fill-1)",
          compact && "hidden",
        )}
      >
        <HoldButton
          label="Back one day"
          className="shadow-[var(--f-border-1)_-1px_0px_0px_inset]"
          onStep={(animated) => timeline.step(-1, DAY, { animated })}
        >
          <StepBack />
        </HoldButton>

        <Ruler timeline={timeline} now={now} />

        <HoldButton
          label="Forward one day"
          className={cn("shadow-[var(--f-border-1)_1px_0px_0px_inset]", live && "opacity-35")}
          disabled={live}
          onStep={(animated) => timeline.step(1, DAY, { animated })}
        >
          <StepForward />
        </HoldButton>
      </div>

      <LiveButton live={live} onGoLive={() => timeline.goLive(true)} />
    </div>
  )
}

function LiveButton({ live, onGoLive }: { live: boolean; onGoLive: () => void }) {
  return (
    <button
      type="button"
      disabled={live}
      onClick={onGoLive}
      className={cn(
        "flex h-[28px] shrink-0 f-press items-center gap-[6px] rounded-lg px-[10px]",
        !live && "shadow-[var(--f-border-1)_0px_0px_0px_1px] f-press-fill",
      )}
    >
      <span
        className={cn(
          "size-2 shrink-0 rounded-full transition-colors duration-200",
          live ? "bg-(--f-live)" : "shadow-[var(--f-text-2)_0px_0px_0px_1.5px_inset]",
        )}
      />
      <span className={cn("t-sm w-med", live ? "text-(--f-text-1)" : "text-(--f-text-2)")}>
        {live ? "Live" : "Go live"}
      </span>
    </button>
  )
}

function Ruler({ timeline, now }: { timeline: TimelineController; now: number }) {
  const start = timeline.start
  const at = timeline.at
  const live = timeline.mode === "live"
  const ruler = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1164)
  const drag = useRef<{ offset: number; samples: Array<{ x: number; time: number }>; raw: number } | null>(null)

  useEffect(() => {
    const element = ruler.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  const span = Math.max(1, now - start)
  const fraction = live ? 1 : Math.min(1, Math.max(0, (at - start) / span))
  const toTime = (px: number) => start + (px / width) * span

  const ticks = useMemo(() => {
    const out: Array<{ t: number; kind: TickKind }> = []
    for (let t = startOfDay(start); t <= now; t += SNAP) {
      if (t >= start) out.push({ t, kind: tickKind(t) })
    }
    return out
  }, [start, now])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !ruler.current) return
    ruler.current.setPointerCapture(event.pointerId)
    const rect = ruler.current.getBoundingClientRect()
    const px = event.clientX - rect.left
    const head = fraction * width
    const offset = Math.abs(px - head) <= 10 ? px - head : 0
    drag.current = { offset, samples: [{ x: px, time: event.timeStamp }], raw: px - offset }
    timeline.stop()
    timeline.setScrubbing(true)
    timeline.pauseAt(toTime(px - offset))
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state || !ruler.current) return
    const rect = ruler.current.getBoundingClientRect()
    const px = event.clientX - rect.left
    state.samples.push({ x: px, time: event.timeStamp })
    if (state.samples.length > 6) state.samples.shift()
    const raw = px - state.offset
    state.raw = raw
    if (raw < 0) {
      timeline.setOvershoot(-rubber(-raw, width))
      timeline.pauseAt(start)
    } else if (raw > width) {
      timeline.setOvershoot(rubber(raw - width, width))
      timeline.pauseAt(now)
    } else {
      timeline.setOvershoot(0)
      timeline.pauseAt(toTime(raw))
    }
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state) return
    drag.current = null
    ruler.current?.releasePointerCapture(event.pointerId)
    timeline.setScrubbing(false)
    if (state.raw < 0 || state.raw > width) {
      timeline.springOvershoot(timeline.overshoot)
      if (state.raw > width) timeline.goLive(true)
      return
    }
    const first = state.samples.at(0)
    const last = state.samples.at(-1)
    if (!first || !last) return
    const elapsed = last.time - first.time
    const velocity = elapsed > 0 && event.timeStamp - last.time < 80 ? (last.x - first.x) / elapsed : 0
    if (Math.abs(velocity) < FLICK) return
    const projected = state.raw + (velocity * DECELERATION) / (1 - DECELERATION)
    const projectedTime = toTime(projected)
    const snapped = start + Math.round((projectedTime - start) / SNAP) * SNAP
    const msPerPx = span / width
    timeline.springTo(snapped, { bounce: 0.2, velocity: velocity * msPerPx * 1000, thenLive: snapped >= now })
  }

  const nearLeft = !live && fraction * width + timeline.overshoot < 48

  return (
    <div
      ref={ruler}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a pointer-driven ruler with a rubber-band overshoot, which a range input cannot draw
      role="slider"
      aria-label="Factory timeline"
      aria-valuemin={start}
      aria-valuemax={now}
      aria-valuenow={Math.round(at)}
      aria-valuetext={`${formatDayLabel(at)} ${formatClock(at)}`}
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="relative flex grow cursor-ew-resize touch-none overflow-clip select-none"
    >
      {ticks.map((tick) => (
        <div key={tick.t} className="absolute inset-y-0" style={{ left: `${((tick.t - start) / span) * 100}%` }}>
          {tick.kind === "day" && (1 - (tick.t - start) / span) * width >= 44 ? (
            <div className="absolute top-[3px] left-0 w-max pl-1 t-2xs font-medium text-(--f-text-2)">
              {formatDayLabel(tick.t)}
            </div>
          ) : null}
          <div className={cn("absolute bottom-0 left-0 w-px", TICK_CLASS[tick.kind])} />
        </div>
      ))}
      <div
        className={cn("absolute top-[3px] right-[6px] w-max t-2xs font-medium text-(--f-text-2)", live && "opacity-0")}
      >
        Now
      </div>
      <div
        className={cn(
          "pointer-events-none absolute inset-y-0 flex w-0 flex-col items-center overflow-visible",
          nearLeft && "items-start",
          live && "items-end",
        )}
        style={live ? { left: "100%" } : { left: `calc(${fraction * 100}% + ${timeline.overshoot}px)` }}
      >
        <Readout at={at} now={now} scrubbing={timeline.scrubbing} />
        <div className="w-[2px] shrink-0 grow rounded-full bg-(--f-build)" />
      </div>
    </div>
  )
}

function Readout({ at, now, scrubbing }: { at: number; now: number; scrubbing: boolean }) {
  return (
    <div className="flex w-max shrink-0 items-baseline gap-[6px] rounded-sm bg-(--f-bg-secondary) px-[6px] pt-[3px]">
      <div className="w-max tnum text-[12px] leading-[14px] w-semi text-(--f-text-1)">
        {scrubbing ? `${formatDayLabel(at)} · ${formatClock(at)}` : formatClock(at)}
      </div>
      {scrubbing && now - at > HOUR / 2 ? (
        <div className="w-max t-2xs text-(--f-text-2)">{formatAgo(now - at)}</div>
      ) : null}
    </div>
  )
}

function ControlButton({
  label,
  className,
  onClick,
  children,
}: {
  label: string
  className?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn("flex h-[28px] shrink-0 f-press items-center rounded-lg f-press-fill", className)}
    >
      {children}
    </button>
  )
}

function HoldButton({
  label,
  className,
  disabled,
  onStep,
  children,
}: {
  label: string
  className?: string
  disabled?: boolean
  onStep: (animated: boolean) => void
  children: ReactNode
}) {
  const timer = useRef<number | undefined>(undefined)
  const stop = () => window.clearTimeout(timer.current)
  useEffect(() => stop, [])
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onPointerDown={(event) => {
        if (event.button !== 0 || disabled) return
        onStep(true)
        let interval = 160
        const repeat = () => {
          onStep(false)
          interval = Math.max(40, interval * 0.82)
          timer.current = window.setTimeout(repeat, interval)
        }
        timer.current = window.setTimeout(repeat, 400)
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(event) => {
        if (event.key === "Enter") onStep(false)
      }}
      className={cn("flex w-[28px] shrink-0 f-press items-center justify-center", className)}
    >
      {children}
    </button>
  )
}

function SpeedMenu({ speed, onChange }: { speed: number; onChange: (speed: Speed) => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Playback speed"
        className="flex h-[28px] shrink-0 f-press items-center gap-1 rounded-lg bg-(--f-fill-1) pr-2 pl-[10px] f-press-fill data-popup-open:bg-(--f-fill-2)"
      >
        <span className="tnum t-xs w-med text-(--f-text-1)">{speed}×</span>
        <SmallChevronDown />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={6} className="z-50 factory">
          <Menu.Popup
            // oxlint-disable-next-line ren/require-companion-class -- focus moves to the items, which mark it with data-highlighted
            className="flex w-[128px] f-menu flex-col gap-[2px] rounded-[10px] bg-(--f-bg-secondary) p-1 shadow-[var(--f-border-1)_0px_0px_0px_1px,#00000066_0px_8px_24px] outline-none"
          >
            <Menu.RadioGroup
              value={speed}
              onValueChange={(value) => {
                const next = SPEEDS.find((option) => option === value)
                if (next) onChange(next)
              }}
            >
              <Menu.GroupLabel className="px-2 pt-1 pb-[2px] t-2xs font-medium text-(--f-text-2)">
                Playback speed
              </Menu.GroupLabel>
              {SPEEDS.map((option) => (
                <SpeedOption key={option} speed={option} />
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

function SpeedOption({ speed }: { speed: Speed }) {
  return (
    <Menu.RadioItem
      value={speed}
      closeOnClick
      // oxlint-disable-next-line ren/require-companion-class -- Base UI marks the keyboard-focused item with data-highlighted
      className="flex h-[28px] shrink-0 cursor-default items-center justify-between rounded-md px-2 t-xs font-medium text-(--f-text-1) outline-none data-checked:bg-(--f-fill-2) data-highlighted:bg-(--f-fill-1)"
    >
      {speed}×
      <Menu.RadioItemIndicator>
        <MenuCheck />
      </Menu.RadioItemIndicator>
    </Menu.RadioItem>
  )
}
