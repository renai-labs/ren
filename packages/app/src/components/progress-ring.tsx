import { cn } from "cn"

export function ProgressRing(props: { done: number; total: number; className?: string | undefined }) {
  const length = 2 * Math.PI * 5
  return (
    <svg aria-hidden viewBox="0 0 14 14" className={cn("size-3.5 -rotate-90", props.className)}>
      <circle cx="7" cy="7" r="5" fill="none" strokeWidth="2" className="stroke-muted-foreground/30" />
      <circle
        cx="7"
        cy="7"
        r="5"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${(props.done / props.total) * length} ${length}`}
        className={props.done === props.total ? "stroke-chart-6" : "stroke-muted-foreground"}
      />
    </svg>
  )
}
