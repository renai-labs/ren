import { cn } from "cn"

const radius = 6
const circumference = 2 * Math.PI * radius

export function ProgressRing(props: {
  value: number
  label?: string | undefined
  stroke?: number | undefined
  className?: string | undefined
}) {
  const value = Math.min(Math.max(props.value, 0), 1)
  const stroke = props.stroke ?? 2
  return (
    <svg
      viewBox="0 0 16 16"
      role={props.label ? "img" : undefined}
      aria-hidden={props.label ? undefined : true}
      aria-label={props.label ? `${props.label}: ${Math.round(value * 100)}%` : undefined}
      className={cn("size-4 shrink-0", props.className)}
    >
      <circle cx="8" cy="8" r={radius} fill="none" strokeWidth={stroke} className="stroke-current opacity-20" />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap={value > 0 ? "round" : "butt"}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - value)}
        transform="rotate(-90 8 8)"
        className="stroke-chart-1 transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
      />
    </svg>
  )
}
