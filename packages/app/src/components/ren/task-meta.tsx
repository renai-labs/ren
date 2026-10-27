import { useId, type SVGProps } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { TaskInfo } from "@ren/client"

type GlyphProps = { className?: string | undefined; "aria-label"?: string | undefined }

type RingState = "empty" | "half" | "complete" | "dismissed"

function ProgressRing(props: GlyphProps & { state: RingState }) {
  const mask = useId()
  const svg: SVGProps<SVGSVGElement> = {
    viewBox: "-1 -1 16 16",
    className: props.className,
    role: "img",
    "aria-label": props["aria-label"],
  }
  if (props.state === "complete" || props.state === "dismissed") {
    return (
      <svg {...svg}>
        <mask id={mask}>
          <circle cx="7" cy="7" r="7" fill="white" />
          <path
            d={props.state === "complete" ? "M4 7.2 5.9 9.1 10 5" : "M4.75 4.75 9.25 9.25M9.25 4.75 4.75 9.25"}
            fill="none"
            stroke="black"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
        <circle cx="7" cy="7" r="7" fill="currentColor" mask={`url(#${mask})`} />
      </svg>
    )
  }
  const circumference = 2 * Math.PI * 2
  return (
    <svg {...svg}>
      <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {props.state === "half" ? (
        <circle
          cx="7"
          cy="7"
          r="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeDasharray={`${circumference / 2} ${circumference}`}
          transform="rotate(-90 7 7)"
        />
      ) : null}
    </svg>
  )
}

const bars = [
  { x: 1.5, y: 8, height: 6 },
  { x: 6.5, y: 5, height: 9 },
  { x: 11.5, y: 2, height: 12 },
]

function SignalBars(props: GlyphProps & { level: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={props.className}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an inline SVG glyph with a label
      role="img"
      aria-label={props["aria-label"]}
    >
      {bars.map((bar, index) =>
        props.level === 0 ? (
          <rect key={bar.x} x={bar.x} y="7.25" width="3" height="1.5" rx="0.5" fill="currentColor" />
        ) : (
          <rect
            key={bar.x}
            x={bar.x}
            y={bar.y}
            width="3"
            height={bar.height}
            rx="1"
            fill="currentColor"
            opacity={index < props.level ? 1 : 0.5}
          />
        ),
      )}
    </svg>
  )
}

export function UnassignedIcon(props: GlyphProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-4 text-muted-foreground", props.className)}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an inline SVG glyph with a label
      role="img"
      aria-label={props["aria-label"] ?? "Unassigned"}
    >
      <circle
        cx="8"
        cy="8"
        r="7.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeDasharray="2.2 1.6"
        strokeLinecap="round"
      />
      <circle cx="8" cy="6.6" r="2.2" fill="currentColor" />
      <path
        d="M4.4 12.4a4.3 4.3 0 0 1 7.2 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export const statuses = {
  todo: { label: "Todo", ring: "empty", color: "text-muted-foreground" },
  in_progress: { label: "In progress", ring: "half", color: "text-chart-3" },
  done: { label: "Done", ring: "complete", color: "text-[#5e6ad2]" },
  dismissed: {
    label: "Dismissed",
    ring: "dismissed",
    color: "text-muted-foreground",
  },
} as const

export function StatusGlyph(props: { status: string; className?: string | undefined }) {
  const status = statusOf(props.status)
  return (
    <ProgressRing
      state={status.ring}
      className={cn("size-4 shrink-0", status.color, props.className)}
      aria-label={status.label}
    />
  )
}

export function StatusIcon(props: { task: Pick<TaskInfo, "status"> }) {
  return <StatusGlyph status={props.task.status} />
}

export const statusOf = (value: string) =>
  Object.entries(statuses).find((entry) => entry[0] === value)?.[1] ?? statuses.todo

export const priorityLabelOf = (value: string | null) =>
  Object.entries(priorities).find((entry) => entry[0] === value)?.[1] ?? "No priority"

export const priorities = {
  high: "High",
  medium: "Medium",
  low: "Low",
} as const

const priorityLevel: Record<string, number> = { low: 1, medium: 2, high: 3 }

export function PriorityIcon(props: { priority: string | null; className?: string | undefined }) {
  return (
    <SignalBars
      level={props.priority ? (priorityLevel[props.priority] ?? 0) : 0}
      className={cn("size-4 shrink-0 text-muted-foreground", props.className)}
      aria-label={props.priority ?? "No priority"}
    />
  )
}

export const labelColor = (color: string | null | undefined) => color ?? "var(--muted-foreground)"

export function LabelBadge(props: { name: string; color?: string | null | undefined }) {
  return (
    <Badge variant="outline" className="h-6 gap-2 rounded-full bg-muted">
      <span className="size-2 rounded-full" style={{ background: labelColor(props.color) }} />
      {props.name}
    </Badge>
  )
}
